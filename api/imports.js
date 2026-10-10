const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { pool } = require("./postgres-store");
const { forEachInvoiceRow, invoiceKey } = require("./supplier-invoice-csv");

const router = express.Router();
const uploadsRoot = process.env.UPLOADS_DIR || path.join(__dirname, "..", "public", "uploads");
const importsDirectory = path.join(uploadsRoot, "inventory-imports");
fs.mkdirSync(importsDirectory, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: importsDirectory,
        filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}.csv`),
    }),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter(req, file, callback) {
        if (path.extname(file.originalname).toLowerCase() !== ".csv") {
            return callback(new Error("Upload a .csv file."));
        }
        callback(null, true);
    },
});

function publicImport(row) {
    return {
        id: row.id,
        originalFilename: row.original_filename,
        fileSize: Number(row.file_size),
        uploadedBy: row.uploaded_by,
        uploadedAt: row.uploaded_at,
        status: row.status,
        summary: row.summary,
        errorMessage: row.error_message,
        processedAt: row.processed_at,
    };
}

async function loadImport(id) {
    const { rows } = await pool.query("SELECT * FROM inventory_imports WHERE id = $1", [id]);
    return rows[0] || null;
}

function resolveImportFile(record) {
    const filePath = path.resolve(importsDirectory, path.basename(record.storage_filename));
    if (!filePath.startsWith(`${path.resolve(importsDirectory)}${path.sep}`)) {
        throw new Error("Invalid stored import file path.");
    }
    return filePath;
}

async function findMatchingProducts(client, product) {
    const code = product.code || null;
    const barcode = product.barcode || null;
    const name = product.name || null;
    const company = product.company ? product.company.toLocaleLowerCase("en-US") : null;
    const pack = product.pack ? product.pack.toLocaleLowerCase("en-US") : null;
    const { rows } = await client.query(
        `SELECT id, document FROM app_records
         WHERE collection = 'inventory' AND (
             ($1::text IS NOT NULL AND (document ->> 'supplierCode' = $1 OR document ->> 'sku' = $1 OR document ->> 'barcodeValue' = $1 OR document ->> 'barcode' = $1))
             OR ($2::text IS NOT NULL AND (document ->> 'barcodeValue' = $2 OR document ->> 'barcode' = $2))
             OR ($3::text IS NOT NULL AND LOWER(document ->> 'name') = LOWER($3)
                 AND ($4::text IS NULL OR LOWER(COALESCE(document ->> 'company', '')) = $4)
                 AND ($5::text IS NULL OR LOWER(COALESCE(document ->> 'pack', '')) = $5))
         )
         ORDER BY id
         LIMIT 3
         FOR UPDATE`,
        [code, barcode, name, company, pack],
    );
    return rows;
}

async function createProductId(client) {
    for (;;) {
        const id = Number(`${Date.now()}${crypto.randomInt(100, 999)}`);
        const { rowCount } = await client.query(
            "SELECT 1 FROM app_records WHERE collection = 'inventory' AND id = $1",
            [String(id)],
        );
        if (!rowCount) return id;
    }
}

function signatureFor(product) {
    const stableRow = [
        product.code,
        product.barcode,
        product.name.toLocaleLowerCase("en-US"),
        product.company,
        product.pack,
        product.batchNumber,
        product.expiryDate,
    ];
    return crypto.createHash("sha256").update(JSON.stringify(stableRow)).digest("hex");
}

router.post("/", (req, res, next) => {
    upload.single("file")(req, res, (error) => {
        if (error) {
            return res.status(error instanceof multer.MulterError ? 400 : 400).json({ error: error.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a CSV file to upload." });
    const id = crypto.randomUUID();
    const originalFilename = path.basename(String(req.file.originalname || "supplier-invoice.csv").replace(/\\/g, "/")).replace(/[\r\n\0]/g, "").slice(0, 255);
    try {
        const { rows } = await pool.query(
            `INSERT INTO inventory_imports
             (id, original_filename, storage_filename, file_path, uploaded_by, file_size, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')
             RETURNING *`,
            [id, originalFilename, req.file.filename, resolveImportFile({ storage_filename: req.file.filename }), String(req.session.userId), req.file.size],
        );
        res.status(201).json(publicImport(rows[0]));
    } catch (error) {
        fs.unlink(req.file.path, () => {});
        console.error("Unable to record inventory import:", error.message);
        res.status(500).json({ error: "Unable to save uploaded CSV metadata." });
    }
});

router.get("/", async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM inventory_imports ORDER BY uploaded_at DESC LIMIT 200");
        res.json(rows.map(publicImport));
    } catch (error) {
        console.error("Unable to list inventory imports:", error.message);
        res.status(500).json({ error: "Unable to load inventory import history." });
    }
});

router.get("/:id/file", async (req, res) => {
    try {
        const record = await loadImport(req.params.id);
        if (!record) return res.sendStatus(404);
        const filePath = resolveImportFile(record);
        if (!fs.existsSync(filePath)) return res.sendStatus(404);
        res.download(filePath, record.original_filename);
    } catch (error) {
        console.error("Unable to download inventory import:", error.message);
        res.status(500).json({ error: "Unable to download this file." });
    }
});

router.get("/:id/errors.csv", async (req, res) => {
    try {
        const record = await loadImport(req.params.id);
        if (!record) return res.sendStatus(404);
        const { rows } = await pool.query(
            "SELECT row_number, errors, row_data FROM inventory_import_errors WHERE import_id = $1 ORDER BY row_number",
            [record.id],
        );
        const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
        res.type("text/csv").attachment(`${path.parse(record.original_filename).name}-errors.csv`);
        res.write("Row,Errors,Original data\r\n");
        for (const row of rows) {
            res.write(`${row.row_number},${csvCell((row.errors || []).join("; "))},${csvCell(JSON.stringify(row.row_data))}\r\n`);
        }
        res.end();
    } catch (error) {
        console.error("Unable to export import errors:", error.message);
        res.status(500).json({ error: "Unable to export import errors." });
    }
});

router.get("/:id/preview", async (req, res) => {
    const record = await loadImport(req.params.id);
    if (!record) return res.sendStatus(404);
    if (record.committed_at) return res.status(409).json({ error: "This invoice was already imported." });
    const startedAt = Date.now();
    const summary = { totalRows: 0, validRows: 0, invalidRows: 0, newProducts: 0, existingProducts: 0, matchingBatches: 0, duplicateRows: 0 };
    const examples = [];
    let key = null;
    let mixedInvoices = false;
    const seenSignatures = new Set();
    try {
        await pool.query("DELETE FROM inventory_import_errors WHERE import_id=$1", [record.id]);
        await forEachInvoiceRow(resolveImportFile(record), async (parsed) => {
            summary.totalRows += 1;
            const product = parsed.product;
            const rowKey = invoiceKey(product.supplier, product.invoiceNumber);
            if (key === null) key = rowKey;
            else if (key !== rowKey) mixedInvoices = true;
            const signature = signatureFor(product);
            let duplicate = seenSignatures.has(signature);
            seenSignatures.add(signature);
            const matchResult = parsed.errors.length ? [] : await findMatchingProducts(pool, product);
            if (!duplicate && !parsed.errors.length) {
                const priorRow = await pool.query(
                    "SELECT 1 FROM inventory_import_rows WHERE invoice_key=$1 AND row_signature=$2 AND outcome IN ('created','matched') LIMIT 1",
                    [rowKey, signature],
                );
                duplicate = priorRow.rowCount > 0;
            }
            const ambiguous = matchResult.length > 1;
            const errors = [...parsed.errors];
            if (ambiguous) errors.push("Product code/barcode matches more than one existing product; resolve the match before importing.");
            if (errors.length) {
                await pool.query(
                    `INSERT INTO inventory_import_errors (import_id,row_number,errors,row_data)
                     VALUES ($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT (import_id,row_number) DO UPDATE
                     SET errors=EXCLUDED.errors,row_data=EXCLUDED.row_data`,
                    [record.id, parsed.rowNumber, JSON.stringify(errors), JSON.stringify(parsed.row)],
                );
            }
            if (duplicate) summary.duplicateRows += 1;
            if (errors.length) summary.invalidRows += 1;
            else if (!duplicate) {
                summary.validRows += 1;
                if (matchResult.length) summary.existingProducts += 1;
                else summary.newProducts += 1;
            }
            let matchingBatch = false;
            if (matchResult.length === 1) {
                const batchResult = await pool.query(
                    `SELECT 1 FROM pharmacy_batches WHERE product_id = $1 AND batch_number = $2 AND expiry_date IS NOT DISTINCT FROM $3::date LIMIT 1`,
                    [matchResult[0].id, product.batchNumber, product.expiryDate],
                );
                matchingBatch = batchResult.rowCount > 0;
                if (matchingBatch && !duplicate) summary.matchingBatches += 1;
            }
            if (examples.length < 100) {
                examples.push({
                    rowNumber: parsed.rowNumber,
                    name: product.name,
                    code: product.code,
                    barcode: product.barcode,
                    batch: product.batchNumber,
                    expiryDate: product.expiryDate,
                    quantity: product.stockQuantity,
                    saleRate: product.saleRate,
                    category: null,
                    match: matchResult.length ? "existing" : "new",
                    batchMatch: matchingBatch,
                    duplicate,
                    errors,
                });
            }
        });
        if (mixedInvoices) throw new Error("This file contains more than one supplier invoice. Upload one invoice per file.");
        if (!key) throw new Error("CSV contains no product rows.");
        const alreadyImported = await pool.query(
            "SELECT 1 FROM inventory_imports WHERE invoice_key = $1 AND committed_at IS NOT NULL LIMIT 1",
            [key],
        );
        const duplicateInvoice = alreadyImported.rowCount > 0;
        const status = duplicateInvoice ? "failed" : "uploaded";
        const errorMessage = duplicateInvoice ? "This supplier invoice has already been imported." : null;
        await pool.query(
            "UPDATE inventory_imports SET invoice_key = $2, status = $3, summary = $4::jsonb, error_message = $5, processed_at = NOW() WHERE id = $1",
            [record.id, key, status, JSON.stringify({ ...summary, durationMs: Date.now() - startedAt }), errorMessage],
        );
        if (duplicateInvoice) return res.status(409).json({ error: errorMessage, summary, rows: examples });
        res.json({ summary: { ...summary, durationMs: Date.now() - startedAt }, invoiceKey: key, rows: examples });
    } catch (error) {
        const publicMessage = error.message.startsWith("CSV") || error.message.startsWith("This file")
            ? error.message
            : "Unable to parse the uploaded CSV. Check its headers and row formatting.";
        await pool.query(
            "UPDATE inventory_imports SET status = 'failed', error_message = $2, processed_at = NOW() WHERE id = $1",
            [record.id, publicMessage],
        );
        console.error("Inventory import preview failed:", error.message);
        res.status(400).json({ error: publicMessage });
    }
});

router.post("/:id/commit", async (req, res) => {
    if (req.body.confirm !== true) return res.status(400).json({ error: "Confirm the preview before importing." });
    const id = req.params.id;
    const record = await loadImport(id);
    if (!record) return res.sendStatus(404);
    if (record.committed_at) return res.status(409).json({ error: "This invoice was already imported." });
    if (!record.invoice_key) return res.status(409).json({ error: "Preview this file before importing." });

    await pool.query("UPDATE inventory_imports SET status = 'processing', error_message = NULL WHERE id = $1", [id]);
    const startedAt = Date.now();
    const summary = { totalRows: 0, importedRows: 0, productsCreated: 0, productsMatched: 0, batchesCreated: 0, batchesUpdated: 0, quantityAdded: 0, duplicateRows: 0, skippedRows: 0, failedRows: 0 };
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [record.invoice_key]);
        await client.query(
            "DELETE FROM inventory_import_rows WHERE import_id=$1 AND outcome IN ('invalid','duplicate')",
            [id],
        );
        await client.query("DELETE FROM inventory_import_errors WHERE import_id=$1", [id]);
        const duplicateInvoice = await client.query(
            "SELECT 1 FROM inventory_imports WHERE invoice_key = $1 AND committed_at IS NOT NULL AND id <> $2 LIMIT 1",
            [record.invoice_key, id],
        );
        if (duplicateInvoice.rowCount) {
            await client.query("ROLLBACK");
            await pool.query("UPDATE inventory_imports SET status='failed', error_message=$2 WHERE id=$1", [id, "This supplier invoice has already been imported."]);
            return res.status(409).json({ error: "This supplier invoice has already been imported." });
        }

        await forEachInvoiceRow(resolveImportFile(record), async (parsed) => {
            summary.totalRows += 1;
            const product = parsed.product;
            const currentKey = invoiceKey(product.supplier, product.invoiceNumber);
            let errors = [...parsed.errors];
            if (currentKey !== record.invoice_key) errors.push("Invoice identity changed after preview.");
            if (errors.length) {
                summary.failedRows += 1;
                summary.skippedRows += 1;
                await client.query(
                    `INSERT INTO inventory_import_errors (import_id, row_number, errors, row_data)
                     VALUES ($1, $2, $3::jsonb, $4::jsonb) ON CONFLICT (import_id, row_number) DO NOTHING`,
                    [id, parsed.rowNumber, JSON.stringify(errors), JSON.stringify(parsed.row)],
                );
                await client.query(
                    `INSERT INTO inventory_import_rows (import_id,invoice_key,row_number,row_signature,outcome,errors,row_data)
                     VALUES ($1,$2,$3,$4,'invalid',$5::jsonb,$6::jsonb) ON CONFLICT (import_id,row_number) DO NOTHING`,
                    [id, record.invoice_key, parsed.rowNumber, signatureFor(product), JSON.stringify(errors), JSON.stringify(parsed.row)],
                );
                return;
            }

            const signature = signatureFor(product);
            const duplicateRow = await client.query(
                "SELECT 1 FROM inventory_import_rows WHERE invoice_key=$1 AND row_signature=$2 AND outcome IN ('created','matched') LIMIT 1",
                [record.invoice_key, signature],
            );
            if (duplicateRow.rowCount) {
                summary.duplicateRows += 1;
                summary.skippedRows += 1;
                await client.query(
                    `INSERT INTO inventory_import_rows (import_id,invoice_key,row_number,row_signature,outcome,errors,row_data)
                     VALUES ($1,$2,$3,$4,'duplicate',$5::jsonb,$6::jsonb) ON CONFLICT (import_id,row_number) DO NOTHING`,
                    [id, record.invoice_key, parsed.rowNumber, signature, JSON.stringify(["Duplicate invoice line skipped."]), JSON.stringify(parsed.row)],
                );
                return;
            }

            const matches = await findMatchingProducts(client, product);
            if (matches.length > 1) {
                errors.push("Product identity is ambiguous; no inventory was changed.");
                summary.failedRows += 1;
                summary.skippedRows += 1;
                await client.query(
                    `INSERT INTO inventory_import_errors (import_id,row_number,errors,row_data) VALUES ($1,$2,$3::jsonb,$4::jsonb)
                     ON CONFLICT (import_id,row_number) DO NOTHING`,
                    [id, parsed.rowNumber, JSON.stringify(errors), JSON.stringify(parsed.row)],
                );
                await client.query(
                    `INSERT INTO inventory_import_rows (import_id,invoice_key,row_number,row_signature,outcome,errors,row_data)
                     VALUES ($1,$2,$3,$4,'invalid',$5::jsonb,$6::jsonb) ON CONFLICT (import_id,row_number) DO NOTHING`,
                    [id, record.invoice_key, parsed.rowNumber, signature, JSON.stringify(errors), JSON.stringify(parsed.row)],
                );
                return;
            }

            const existing = matches[0] || null;
            const productId = existing ? existing.id : String(await createProductId(client));
            const previous = existing ? existing.document : {};
            const quantity = Number(previous.quantity) || 0;
            const numericBarcode = product.barcode && /^\d+$/.test(product.barcode) ? Number(product.barcode) : previous.barcode || "";
            const document = {
                ...previous,
                _id: existing ? previous._id : Number(productId),
                name: product.name,
                barcode: numericBarcode,
                barcodeValue: product.barcode,
                supplierCode: product.code,
                company: product.company,
                pack: product.pack,
                supplier: product.supplier,
                price: product.saleRate,
                mrp: product.mrp,
                quantity: quantity + product.stockQuantity,
                stock: 1,
                minStock: previous.minStock ?? 0,
                expirationDate: previous.expirationDate || product.expiryDate || "",
                category: existing ? (previous.category ?? null) : null,
                img: previous.img || "",
            };
            if (existing) {
                await client.query(
                    "UPDATE app_records SET document=$2::jsonb WHERE collection='inventory' AND id=$1",
                    [productId, JSON.stringify(document)],
                );
                summary.productsMatched += 1;
            } else {
                await client.query(
                    "INSERT INTO app_records (collection,id,document) VALUES ('inventory',$1,$2::jsonb)",
                    [productId, JSON.stringify(document)],
                );
                summary.productsCreated += 1;
            }

            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${productId}:${product.batchNumber}:${product.expiryDate || ""}`]);
            const batchResult = await client.query(
                `SELECT id, quantity FROM pharmacy_batches
                 WHERE product_id=$1 AND batch_number=$2 AND expiry_date IS NOT DISTINCT FROM $3::date
                 FOR UPDATE`,
                [productId, product.batchNumber, product.expiryDate],
            );
            let batchId;
            if (batchResult.rowCount) {
                batchId = batchResult.rows[0].id;
                await client.query(
                    `UPDATE pharmacy_batches SET quantity=quantity+$2, purchase_rate=COALESCE($3,purchase_rate),
                     sale_rate=$4, mrp=COALESCE($5,mrp), supplier=$6, supplier_code=$7, invoice_number=$8,
                     source_import_id=$9, source_metadata=$10::jsonb, updated_at=NOW() WHERE id=$1`,
                    [batchId, product.stockQuantity, product.purchaseRate, product.saleRate, product.mrp, product.supplier, product.code, product.invoiceNumber, id, JSON.stringify(product.extra)],
                );
                summary.batchesUpdated += 1;
            } else {
                batchId = crypto.randomUUID();
                await client.query(
                    `INSERT INTO pharmacy_batches
                     (id,product_id,batch_number,expiry_date,quantity,purchase_rate,sale_rate,mrp,supplier,supplier_code,invoice_number,source_import_id,source_metadata)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
                    [batchId, productId, product.batchNumber, product.expiryDate, product.stockQuantity, product.purchaseRate, product.saleRate, product.mrp, product.supplier, product.code, product.invoiceNumber, id, JSON.stringify(product.extra)],
                );
                summary.batchesCreated += 1;
            }
            await client.query(
                `INSERT INTO pharmacy_stock_movements (id,product_id,batch_id,quantity_delta,reason,reference_id,actor_id,metadata)
                 VALUES ($1,$2,$3,$4,'supplier_import',$5,$6,$7::jsonb)`,
                [crypto.randomUUID(), productId, batchId, product.stockQuantity, id, String(req.session.userId), JSON.stringify({ invoiceNumber: product.invoiceNumber, rowNumber: parsed.rowNumber })],
            );
            await client.query(
                `INSERT INTO inventory_import_rows (import_id,invoice_key,row_number,row_signature,outcome,product_id,batch_id,quantity_added,row_data)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [id, record.invoice_key, parsed.rowNumber, signature, existing ? "matched" : "created", productId, batchId, product.stockQuantity, JSON.stringify(parsed.row)],
            );
            summary.importedRows += 1;
            summary.quantityAdded += product.stockQuantity;
        });

        const successRows = summary.importedRows;
        const status = summary.failedRows ? (successRows || summary.duplicateRows ? "completed_with_errors" : "failed") : "completed";
        const finalSummary = { ...summary, durationMs: Date.now() - startedAt };
        await client.query(
            `UPDATE inventory_imports SET status=$2, summary=$3::jsonb, error_message=NULL,
             processed_at=NOW(), committed_at=CASE WHEN $4 = 'completed' THEN NOW() ELSE NULL END WHERE id=$1`,
            [id, status, JSON.stringify(finalSummary), status],
        );
        await client.query("COMMIT");
        res.json({ status, summary: finalSummary });
    } catch (error) {
        await client.query("ROLLBACK");
        await pool.query(
            "UPDATE inventory_imports SET status='failed', error_message=$2, processed_at=NOW() WHERE id=$1",
            [id, "Import failed; no inventory changes were committed."],
        );
        console.error("Inventory import commit failed:", error.message);
        res.status(500).json({ error: "Import failed; no inventory changes were committed." });
    } finally {
        client.release();
    }
});

router.get("/:id", async (req, res) => {
    const record = await loadImport(req.params.id);
    if (!record) return res.sendStatus(404);
    const { rows } = await pool.query(
        "SELECT row_number, errors FROM inventory_import_errors WHERE import_id=$1 ORDER BY row_number LIMIT 200",
        [record.id],
    );
    res.json({ ...publicImport(record), errors: rows });
});

module.exports = router;
module.exports.signatureFor = signatureFor;