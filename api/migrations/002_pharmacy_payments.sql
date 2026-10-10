CREATE TABLE IF NOT EXISTS pharmacy_payments (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'other')),
    reference TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    received_by TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_payments_transaction_idx
    ON pharmacy_payments (transaction_id, received_at);