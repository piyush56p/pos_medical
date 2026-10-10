const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const { PostgresStore, pool } = require("./postgres-store");
const async = require("async");
const sanitizeFilename = require('sanitize-filename');
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const {filterFile} = require('../assets/js/utils');
const validFileTypes = [
    "image/jpg",
    "image/jpeg",
    "image/png",
    "image/webp"];
const maxFileSize = 2097152 //2MB = 2*1024*1024
const validator = require("validator");
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "..", "public", "uploads");

const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: function (req, file, callback) {
        callback(null, Date.now()+path.extname(file.originalname));
    },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: maxFileSize },
  fileFilter: filterFile,
}).single("imagename");


app.use(bodyParser.json());

module.exports = app;

let inventoryDB = new PostgresStore({ collection: "inventory" });

async function withBatchStock(product) {
    if (!product) return product;
    return (await withBatchStocks([product]))[0];
}

async function withBatchStocks(products) {
    if (!products.length) return products;
    const ids = products.map((product) => String(product._id));
    const [batchResult, locationResult, locationTreeResult] = await Promise.all([
        pool.query(
            `SELECT id, batch_number, expiry_date, quantity, sale_rate, mrp
             FROM pharmacy_batches WHERE product_id=ANY($1::text[]) AND quantity>0
             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
             ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
            [ids],
        ),
        pool.query(
            `SELECT sl.id, sl.product_id, sl.batch_id, sl.location_id, sl.quantity,
                    l.name, l.parent_id, b.batch_number
             FROM pharmacy_stock_locations sl
             JOIN pharmacy_locations l ON l.id=sl.location_id
             LEFT JOIN pharmacy_batches b ON b.id=sl.batch_id
             WHERE sl.product_id=ANY($1::text[]) AND l.active=TRUE
             ORDER BY l.name, b.expiry_date NULLS LAST`,
            [ids],
        ),
        pool.query("SELECT id,name,parent_id FROM pharmacy_locations"),
    ]);
    const batches = new Map();
    batchResult.rows.forEach((row) => {
        const list = batches.get(row.product_id) || [];
        list.push(row);
        batches.set(row.product_id, list);
    });
    const locationsByProduct = new Map();
    const locationNames = new Map(locationTreeResult.rows.map((row) => [row.id, row]));
    locationResult.rows.forEach((row) => {
        const path = [];
        let current = locationNames.get(row.location_id);
        while (current) {
            path.unshift(current.name);
            current = current.parent_id ? locationNames.get(current.parent_id) : null;
        }
        const item = {
            id: row.id,
            batchId: row.batch_id,
            batchNumber: row.batch_number,
            locationId: row.location_id,
            locationLabel: path.join(" / "),
            quantity: Number(row.quantity),
        };
        const list = locationsByProduct.get(row.product_id) || [];
        list.push(item);
        locationsByProduct.set(row.product_id, list);
    });
    return products.map((product) => ({
        ...product,
        batches: batches.get(String(product._id)) || [],
        locations: locationsByProduct.get(String(product._id)) || [],
    }));
}

inventoryDB.ensureIndex({ fieldName: "_id", unique: true });

function generateUniqueProductId(callback) {
    let candidateId = Number(`${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`);

    inventoryDB.findOne({ _id: candidateId }, function (err, existingProduct) {
        if (err) {
            callback(err);
            return;
        }

        if (existingProduct) {
            generateUniqueProductId(callback);
            return;
        }

        callback(null, candidateId);
    });
}

/**
 * GET endpoint: Get the welcome message for the Inventory API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
    res.send("Inventory API");
});

/**
 * GET endpoint: Get product details by product ID.
 *
 * @param {Object} req request object with product ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/product/:productId", async function (req, res) {
    if (!req.params.productId) {
        res.status(500).send("ID field is required.");
    } else {
        try {
            const product = await inventoryDB.findOne({ _id: parseInt(req.params.productId) });
            res.send(await withBatchStock(product));
        } catch (error) {
            console.error("Unable to load product:", error.message);
            res.sendStatus(500);
        }
    }
});

/**
 * GET endpoint: Get details of all products.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/products", async function (req, res) {
    try {
        const docs = await inventoryDB.find({});
        res.send(await withBatchStocks(docs));
    } catch (error) {
        console.error("Unable to load products:", error.message);
        res.sendStatus(500);
    }
});

/**
 * POST endpoint: Create or update a product.
 *
 * @param {Object} req request object with product data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/product", (req, res) => {
    upload(req, res, async (uploadError) => {
        if (uploadError) {
            return res.status(400).json({ error: "Product image upload failed.", message: uploadError.message });
        }

        const body = req.body || {};
        const field = (key) => typeof body[key] === "string" ? body[key].trim() : "";
        const name = field("name");
        const barcodeValue = field("barcode");
        const price = Number(field("price"));
        const quantity = field("quantity") === "" ? 0 : Number(field("quantity"));
        const minStock = field("minStock") === "" ? 0 : Number(field("minStock"));
        const purchaseRate = field("purchaseRate") === "" ? null : Number(field("purchaseRate"));
        const mrp = field("mrp") === "" ? null : Number(field("mrp"));
        const gstRate = field("gstRate") === "" ? null : Number(field("gstRate"));
        if (!name) return res.status(400).json({ error: "Product name is required.", message: "Enter a medicine name." });
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: "Price is invalid.", message: "Enter a valid non-negative sale price." });
        if (!Number.isFinite(quantity) || quantity < 0) return res.status(400).json({ error: "Quantity is invalid.", message: "Enter a valid non-negative stock quantity." });
        if (!Number.isFinite(minStock) || minStock < 0) return res.status(400).json({ error: "Minimum stock is invalid.", message: "Enter a valid non-negative minimum stock quantity." });
        if (purchaseRate !== null && (!Number.isFinite(purchaseRate) || purchaseRate < 0)) return res.status(400).json({ error: "Purchase rate is invalid." });
        if (mrp !== null && (!Number.isFinite(mrp) || mrp < 0)) return res.status(400).json({ error: "MRP is invalid." });
        if (gstRate !== null && (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100)) return res.status(400).json({ error: "GST rate must be between 0 and 100 percent." });

        let image = field("img") ? sanitizeFilename(field("img")) : "";
        if (req.file) image = sanitizeFilename(req.file.filename);
        if (field("remove") === "1" && !req.file && image) {
            const oldImage = path.join(uploadsDir, image);
            if (fs.existsSync(oldImage)) fs.unlinkSync(oldImage);
            image = "";
        }

        const product = {
            _id: field("id") ? Number.parseInt(field("id"), 10) : null,
            barcode: /^\d+$/.test(barcodeValue) ? Number.parseInt(barcodeValue, 10) : "",
            barcodeValue,
            expirationDate: validator.escape(field("expirationDate")),
            price,
            purchaseRate,
            mrp,
            gstRate,
            hsnCode: validator.escape(field("hsnCode")),
            category: validator.escape(field("category") || "0"),
            supplier: validator.escape(field("supplier")),
            quantity,
            name: validator.escape(name),
            manufacturer: validator.escape(field("manufacturer")),
            genericName: validator.escape(field("genericName")),
            packSize: validator.escape(field("packSize")),
            stock: body.stock === "on" ? 0 : 1,
            minStock,
            img: image,
        };

        try {
            if (product._id === null) {
                product._id = await new Promise((resolve, reject) => generateUniqueProductId((error, id) => error ? reject(error) : resolve(id)));
                const saved = await inventoryDB.insert(product);
                return res.status(201).json({ product: saved });
            }
            if (!Number.isInteger(product._id) || product._id <= 0) {
                return res.status(400).json({ error: "Product identifier is invalid.", message: "Reload the product and try again." });
            }
            const assignedLocationStock = await pool.query(
                "SELECT COALESCE(SUM(quantity),0)::numeric AS quantity FROM pharmacy_stock_locations WHERE product_id=$1",
                [String(product._id)],
            );
            if (Number(assignedLocationStock.rows[0].quantity) > product.quantity + 0.0001) {
                return res.status(409).json({
                    error: "Product quantity cannot be lower than stock assigned to physical locations.",
                    message: "Move or clear assigned location stock before reducing total quantity.",
                });
            }
            const [updated, saved] = await inventoryDB.update({ _id: product._id }, product, {});
            if (!updated) return res.status(404).json({ error: "Product was not found.", message: "Refresh inventory and try again." });
            return res.json({ product: saved[0] });
        } catch (error) {
            if (req.file) fs.unlink(req.file.path, () => {});
            console.error("Unable to save inventory product:", error.message);
            return res.status(500).json({ error: "Unable to save product.", message: "The database did not save this product. Please retry." });
        }
    });
});

/**
 * DELETE endpoint: Delete a product by product ID.
 *
 * @param {Object} req request object with product ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.delete("/product/:productId", function (req, res) {
    inventoryDB.remove(
        {
            _id: parseInt(req.params.productId),
        },
        function (err, numRemoved) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                res.sendStatus(200);
            }
        },
    );
});

/**
 * POST endpoint: Find a product by SKU code.
 *
 * @param {Object} req request object with SKU code in the body.
 * @param {Object} res response object.
 * @returns {void}
 */

app.post("/product/sku", async function (req, res) {
    const sku = typeof req.body.skuCode === "string" ? req.body.skuCode.trim() : "";
    if (!sku) return res.status(400).json({ error: "Enter a barcode, product code, or medicine name." });
    const alternatives = [
        { barcodeValue: sku },
        { supplierCode: sku },
        { name: sku },
    ];
    if (/^\d+$/.test(sku)) {
        const numeric = Number(sku);
        alternatives.push({ barcode: numeric }, { _id: numeric });
    }
    try {
        const doc = await inventoryDB.findOne({ $or: alternatives });
        if (doc) res.send(await withBatchStock(doc));
        else res.sendStatus(404);
    } catch (error) {
        console.error("Unable to search product:", error.message);
        res.sendStatus(500);
    }
});

/**
 * Decrement inventory quantities based on a list of products in a transaction.
 *
 * @param {Array} products - List of products in the transaction.
 * @returns {void}
 */
app.decrementInventory = function (products) {
    async.eachSeries(products, function (transactionProduct, callback) {
        inventoryDB.findOne(
            {
                _id: parseInt(transactionProduct.id),
            },
            function (err, product) {
                if (!product || !product.quantity) {
                    callback();
                } else {
                    let updatedQuantity =
                        parseInt(product.quantity) -
                        parseInt(transactionProduct.quantity);

                    inventoryDB.update(
                        {
                            _id: parseInt(product._id),
                        },
                        {
                            $set: {
                                quantity: updatedQuantity,
                            },
                        },
                        {},
                        callback,
                    );
                }
            },
        );
    });
};
