CREATE INDEX IF NOT EXISTS pharmacy_payments_received_at_idx
    ON pharmacy_payments (received_at DESC);
