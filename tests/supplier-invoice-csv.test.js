const fs = require("fs");
const os = require("os");
const path = require("path");
const { forEachInvoiceRow, invoiceKey, mapInvoiceRow, parseExpiry, parseInvoiceDate } = require("../api/supplier-invoice-csv");
const { signatureFor } = require("../api/imports");

describe("supplier invoice CSV parser", () => {
    test("normalizes padded headers and parses sample invoice fields", async () => {
        const filePath = path.join(os.tmpdir(), `supplier-invoice-${Date.now()}.csv`);
        fs.writeFileSync(filePath, [
            "SUPPLIER           ,BILL NO.      ,DATE        ,COMPANY            ,CODE   ,BARCODE    ,ITEM NAME           ,PACK     ,BATCH     ,EXPIRY  ,QTY   ,F.QTY  ,FTRATE   ,SRATE   ,MRP    ,DIS   ,AMOUNT   ,HSNCODE    ,CGST   ,SGST   ,IGST",
            'POOJA MEDICOS,NP-26-561366,09-Oct-26,MOHRISH,23000,HO23000,"ACLIND BP 2.5% GEL, 15 GM",15 GM,CBG002,12/27,1.00,0.25,201.90,201.90,265.00,3.00,195.84,30042095,2.5,2.5,0',
        ].join("\n"));

        const rows = [];
        try {
            await forEachInvoiceRow(filePath, (row) => rows.push(row));
        } finally {
            fs.unlinkSync(filePath);
        }

        expect(rows).toHaveLength(1);
        expect(rows[0].errors).toEqual([]);
        expect(rows[0].product).toMatchObject({
            name: "ACLIND BP 2.5% GEL, 15 GM",
            code: "23000",
            barcode: "HO23000",
            stockQuantity: 1.25,
            saleRate: 201.9,
            purchaseRate: 201.9,
            mrp: 265,
            expiryDate: "2027-12-31",
            invoiceDate: "2026-10-09",
        });
    });

    test("reports invalid quantities, prices, and calendar dates", () => {
        const result = mapInvoiceRow({
            SUPPLIER: "Supplier",
            "BILL NO.": "INV-1",
            "ITEM NAME": "Medicine",
            BATCH: "B1",
            QTY: "one",
            "F.QTY": "",
            SRATE: "not-money",
            DATE: "31-Feb-26",
        });

        expect(result.errors).toEqual(expect.arrayContaining([
            "QTY must be a valid non-negative number.",
            "SRATE must be a valid non-negative number.",
            "DATE is not a supported invoice date.",
        ]));
    });

    test("supports missing expiry and creates a stable invoice idempotency key", () => {
        expect(parseExpiry({})).toBeNull();
        expect(parseExpiry({ EXPIRY: "03/28" })).toBe("2028-03-31");
        expect(parseInvoiceDate("2026-10-09")).toBe("2026-10-09");
        expect(invoiceKey(" POOJA MEDICOS ", "NP-26-561366")).toBe("pooja medicos::np-26-561366");
    });

    test("invoice row identity ignores corrected quantities and rates but preserves batch identity", () => {
        const original = { code: "23000", barcode: "HO23000", name: "Medicine", company: "MOHRISH", pack: "15 GM", batchNumber: "B1", expiryDate: "2027-12-31", quantity: 1, freeQuantity: 0, saleRate: 100 };
        const corrected = { ...original, quantity: 3, saleRate: 120 };
        expect(signatureFor(corrected)).toBe(signatureFor(original));
        expect(signatureFor({ ...original, batchNumber: "B2" })).not.toBe(signatureFor(original));
    });
});