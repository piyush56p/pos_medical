const fs = require("fs");
const { parse } = require("csv-parse");

const requiredColumns = ["SUPPLIER", "BILL NO.", "ITEM NAME", "BATCH", "QTY", "SRATE"];

function normalizeHeader(header) {
    return String(header || "").replace(/^\uFEFF/, "").trim().toUpperCase();
}

function parseNumber(value, field, errors, { required = false, allowNegative = false } = {}) {
    const text = String(value ?? "").trim();
    if (!text) {
        if (required) errors.push(`${field} is required.`);
        return null;
    }
    const number = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(number) || (!allowNegative && number < 0)) {
        errors.push(`${field} must be a valid${allowNegative ? "" : " non-negative"} number.`);
        return null;
    }
    return number;
}

function expandYear(year) {
    const number = Number(year);
    if (!Number.isInteger(number)) return null;
    if (number >= 100) return number;
    return number <= 69 ? 2000 + number : 1900 + number;
}

function parseInvoiceDate(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    let match = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (match) {
        const monthDate = new Date(`${match[2]} 1, 2000 UTC`);
        const year = expandYear(match[3]);
        const day = Number(match[1]);
        if (Number.isNaN(monthDate.getTime()) || day < 1 || day > 31) return null;
        const date = new Date(Date.UTC(year, monthDate.getUTCMonth(), day));
        if (date.getUTCMonth() !== monthDate.getUTCMonth() || date.getUTCDate() !== day) return null;
        return date.toISOString().slice(0, 10);
    }
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (match) {
        const year = expandYear(match[3]);
        const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[1])) return null;
        return date.toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const date = new Date(`${text}T00:00:00.000Z`);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    return null;
}

function parseExpiry(row) {
    const expiry = String(row.EXPIRY || "").trim();
    let match = expiry.match(/^(\d{1,2})\s*[/-]\s*(\d{2,4})$/);
    if (match) {
        const year = expandYear(match[2]);
        const month = Number(match[1]);
        if (month < 1 || month > 12) return null;
        return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }

    const day = String(row.EXPDAY || "").trim();
    const month = String(row.EXPMONTH || "").trim();
    const yearText = String(row.EXPYEAR || "").trim();
    if (day && month && yearText) {
        const year = expandYear(yearText);
        const monthNumber = Number(month);
        const dayNumber = Number(day);
        const date = new Date(Date.UTC(year, monthNumber - 1, dayNumber));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthNumber - 1 || date.getUTCDate() !== dayNumber) return null;
        return date.toISOString().slice(0, 10);
    }
    return null;
}

function mapInvoiceRow(row) {
    const errors = [];
    const supplier = String(row.SUPPLIER || "").trim();
    const invoiceNumber = String(row["BILL NO."] || "").trim();
    const name = String(row["ITEM NAME"] || "").trim();
    const batchNumber = String(row.BATCH || "").trim();
    if (!supplier) errors.push("SUPPLIER is required.");
    if (!invoiceNumber) errors.push("BILL NO. is required.");
    if (!name) errors.push("ITEM NAME is required.");
    if (!batchNumber) errors.push("BATCH is required.");

    const quantity = parseNumber(row.QTY, "QTY", errors, { required: true });
    const freeQuantity = parseNumber(row["F.QTY"], "F.QTY", errors) ?? 0;
    const saleRate = parseNumber(row.SRATE, "SRATE", errors, { required: true });
    const purchaseRate = parseNumber(row.FTRATE, "FTRATE", errors);
    const mrp = parseNumber(row.MRP, "MRP", errors);
    const discountPercent = parseNumber(row.DIS, "DIS", errors);
    const cgst = parseNumber(row.CGST, "CGST", errors) ?? 0;
    const sgst = parseNumber(row.SGST, "SGST", errors) ?? 0;
    const igst = parseNumber(row.IGST, "IGST", errors) ?? 0;
    const invoiceDate = parseInvoiceDate(row.DATE);
    if (row.DATE && !invoiceDate) errors.push("DATE is not a supported invoice date.");
    const expiryDate = parseExpiry(row);
    if ((row.EXPIRY || row.EXPDAY || row.EXPMONTH || row.EXPYEAR) && !expiryDate) {
        errors.push("EXPIRY is not a valid month or date.");
    }
    if (quantity !== null && freeQuantity > 0 && quantity + freeQuantity <= 0) {
        errors.push("QTY plus F.QTY must be greater than zero.");
    }

    return {
        errors,
        product: {
            name,
            code: String(row.CODE || "").trim() || null,
            barcode: String(row.BARCODE || "").trim() || null,
            company: String(row.COMPANY || "").trim() || null,
            pack: String(row.PACK || "").trim() || null,
            batchNumber,
            expiryDate,
            quantity,
            freeQuantity,
            stockQuantity: quantity === null ? null : quantity + freeQuantity,
            saleRate,
            purchaseRate,
            mrp,
            discountPercent,
            supplier,
            invoiceNumber,
            invoiceDate,
            hsnCode: String(row.HSNCODE || "").trim() || null,
            tax: { cgst, sgst, igst },
            lineAmount: parseNumber(row.AMOUNT, "AMOUNT", errors),
            extra: Object.fromEntries(Object.entries(row).filter(([, value]) => String(value || "").trim() !== "")),
        },
    };
}

async function forEachInvoiceRow(filePath, callback) {
    const parser = fs.createReadStream(filePath).pipe(parse({
        bom: true,
        columns(headers) {
            const normalized = headers.map(normalizeHeader);
            const missing = requiredColumns.filter((column) => !normalized.includes(column));
            if (missing.length) {
                throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
            }
            return normalized;
        },
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
    }));
    let rowNumber = 1;
    for await (const row of parser) {
        rowNumber += 1;
        await callback({ rowNumber, row, ...mapInvoiceRow(row) });
    }
    return rowNumber - 1;
}

function invoiceKey(supplier, invoiceNumber) {
    return `${String(supplier || "").trim().toLocaleLowerCase("en-US")}::${String(invoiceNumber || "").trim().toLocaleLowerCase("en-US")}`;
}

module.exports = { forEachInvoiceRow, invoiceKey, mapInvoiceRow, normalizeHeader, parseExpiry, parseInvoiceDate };