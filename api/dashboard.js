const express = require("express");
const { pool } = require("./postgres-store");
const { calculateDashboard, resolveDateRange } = require("./dashboard-metrics");

const router = express.Router();

router.get("/summary", async (req, res) => {
    let range;
    try {
        range = resolveDateRange({
            period: req.query.period || "30d",
            from: req.query.from,
            to: req.query.to,
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const [transactions, products, payments, batches, imports] = await Promise.all([
            pool.query("SELECT document FROM app_records WHERE collection='transactions'"),
            pool.query("SELECT document FROM app_records WHERE collection='inventory'"),
            pool.query("SELECT transaction_id, amount, method, received_at FROM pharmacy_payments"),
            pool.query("SELECT product_id, batch_number, expiry_date, quantity FROM pharmacy_batches"),
            pool.query("SELECT id, original_filename, status, summary, uploaded_at, error_message FROM inventory_imports ORDER BY uploaded_at DESC LIMIT 10"),
        ]);
        res.json(calculateDashboard({
            transactions: transactions.rows.map((row) => row.document),
            products: products.rows.map((row) => row.document),
            payments: payments.rows,
            batches: batches.rows,
            imports: imports.rows,
            range,
        }));
    } catch (error) {
        console.error("Unable to calculate dashboard summary:", error.message);
        res.status(500).json({ error: "Unable to load dashboard data." });
    }
});

module.exports = router;