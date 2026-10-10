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
        const rangeStart = `${range.from} 00:00:00`;
        const rangeEnd = `${range.to} 00:00:00`;
        const [transactions, recentTransactions, credit, products, payments, batches, imports] = await Promise.all([
            pool.query(
                `SELECT document FROM app_records
                 WHERE collection = 'transactions'
                   AND (document->>'status' = '1' OR document->>'billStatus' IN ('paid', 'credit'))
                   AND COALESCE(NULLIF(document->>'date', '')::timestamptz, NULLIF(document->>'finalizedAt', '')::timestamptz)
                       >= ($1::timestamp AT TIME ZONE 'Asia/Kolkata')
                   AND COALESCE(NULLIF(document->>'date', '')::timestamptz, NULLIF(document->>'finalizedAt', '')::timestamptz)
                       < (($2::timestamp + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')`,
                [rangeStart, rangeEnd],
            ),
            pool.query(
                `SELECT document FROM app_records
                 WHERE collection = 'transactions'
                 ORDER BY sequence DESC LIMIT 10`,
            ),
            pool.query(
                `SELECT COALESCE(SUM(GREATEST(0,
                    COALESCE(NULLIF(t.document->>'total', '')::numeric, 0) -
                    CASE WHEN p.transaction_id IS NOT NULL THEN p.amount
                         ELSE LEAST(COALESCE(NULLIF(t.document->>'total', '')::numeric, 0), GREATEST(0,
                             CASE WHEN COALESCE(t.document->>'collected', t.document->>'paid', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                                  THEN COALESCE(t.document->>'collected', t.document->>'paid')::numeric ELSE 0 END -
                             CASE WHEN COALESCE(t.document->>'change', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                                  THEN COALESCE(t.document->>'change')::numeric ELSE 0 END))
                    END)), 0) AS outstanding
                 FROM app_records t
                 LEFT JOIN (
                    SELECT transaction_id, SUM(amount) AS amount
                    FROM pharmacy_payments GROUP BY transaction_id
                 ) p ON p.transaction_id = t.document->>'_id'
                 WHERE t.collection = 'transactions'
                   AND (t.document->>'status' = '1' OR t.document->>'billStatus' IN ('paid', 'credit'))`,
            ),
            pool.query("SELECT document FROM app_records WHERE collection='inventory'"),
            pool.query(
                `WITH range_transactions AS (
                    SELECT document->>'_id' AS id FROM app_records
                    WHERE collection = 'transactions'
                      AND (document->>'status' = '1' OR document->>'billStatus' IN ('paid', 'credit'))
                      AND COALESCE(NULLIF(document->>'date', '')::timestamptz, NULLIF(document->>'finalizedAt', '')::timestamptz)
                          >= ($1::timestamp AT TIME ZONE 'Asia/Kolkata')
                      AND COALESCE(NULLIF(document->>'date', '')::timestamptz, NULLIF(document->>'finalizedAt', '')::timestamptz)
                          < (($2::timestamp + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')
                 )
                 SELECT transaction_id, amount, method, received_at FROM pharmacy_payments
                 WHERE transaction_id IN (SELECT id FROM range_transactions)
                    OR (received_at >= ($1::timestamp AT TIME ZONE 'Asia/Kolkata')
                        AND received_at < (($2::timestamp + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata'))
                    OR id IN (SELECT id FROM pharmacy_payments ORDER BY received_at DESC LIMIT 10)`,
                [rangeStart, rangeEnd],
            ),
            pool.query("SELECT product_id, batch_number, expiry_date, quantity FROM pharmacy_batches"),
            pool.query("SELECT id, original_filename, status, summary, uploaded_at, error_message FROM inventory_imports ORDER BY uploaded_at DESC LIMIT 10"),
        ]);
        res.json(calculateDashboard({
            transactions: transactions.rows.map((row) => row.document),
            recentTransactions: recentTransactions.rows.map((row) => row.document),
            allTimeCreditOverride: Number(credit.rows[0].outstanding) || 0,
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
