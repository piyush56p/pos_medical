CREATE TABLE IF NOT EXISTS pharmacy_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location_type TEXT NOT NULL CHECK (location_type IN ('section','rack','shelf','bin')),
    parent_id TEXT REFERENCES pharmacy_locations(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_locations_parent_idx
    ON pharmacy_locations (parent_id, location_type, name);

CREATE TABLE IF NOT EXISTS pharmacy_stock_locations (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    batch_id TEXT REFERENCES pharmacy_batches(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL REFERENCES pharmacy_locations(id),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    assigned_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_stock_locations_identity_idx
    ON pharmacy_stock_locations (product_id, COALESCE(batch_id, ''), location_id);

CREATE INDEX IF NOT EXISTS pharmacy_stock_locations_product_idx
    ON pharmacy_stock_locations (product_id, batch_id);

CREATE INDEX IF NOT EXISTS pharmacy_stock_locations_location_idx
    ON pharmacy_stock_locations (location_id);

CREATE TABLE IF NOT EXISTS pharmacy_audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT,
    before_state JSONB,
    after_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_audit_log_created_idx
    ON pharmacy_audit_log (created_at DESC);
