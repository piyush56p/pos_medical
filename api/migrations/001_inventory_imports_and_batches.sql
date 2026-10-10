CREATE TABLE IF NOT EXISTS inventory_imports (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    storage_filename TEXT NOT NULL UNIQUE,
    file_path TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    status TEXT NOT NULL CHECK (status IN ('uploaded', 'processing', 'completed', 'completed_with_errors', 'failed')),
    invoice_key TEXT,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS inventory_imports_uploaded_at_idx
    ON inventory_imports (uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_imports_committed_invoice_idx
    ON inventory_imports (invoice_key)
    WHERE invoice_key IS NOT NULL AND committed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_import_errors (
    import_id TEXT NOT NULL REFERENCES inventory_imports(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL CHECK (row_number > 1),
    errors JSONB NOT NULL,
    row_data JSONB NOT NULL,
    PRIMARY KEY (import_id, row_number)
);

CREATE TABLE IF NOT EXISTS inventory_import_rows (
    import_id TEXT NOT NULL REFERENCES inventory_imports(id) ON DELETE CASCADE,
    invoice_key TEXT NOT NULL,
    row_number INTEGER NOT NULL CHECK (row_number > 1),
    row_signature TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('created', 'matched', 'duplicate', 'invalid')),
    product_id TEXT,
    batch_id TEXT,
    quantity_added NUMERIC(14, 3) NOT NULL DEFAULT 0,
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    row_data JSONB NOT NULL,
    PRIMARY KEY (import_id, row_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_import_rows_success_signature_idx
    ON inventory_import_rows (invoice_key, row_signature)
    WHERE outcome IN ('created', 'matched');

CREATE TABLE IF NOT EXISTS pharmacy_batches (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    batch_number TEXT NOT NULL,
    expiry_date DATE,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity >= 0),
    purchase_rate NUMERIC(14, 4),
    sale_rate NUMERIC(14, 4) NOT NULL CHECK (sale_rate >= 0),
    mrp NUMERIC(14, 4),
    supplier TEXT,
    supplier_code TEXT,
    invoice_number TEXT,
    source_import_id TEXT REFERENCES inventory_imports(id),
    source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_batches_product_idx
    ON pharmacy_batches (product_id, expiry_date);

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_batches_identity_idx
    ON pharmacy_batches (product_id, batch_number, (COALESCE(expiry_date, DATE '0001-01-01')));

CREATE TABLE IF NOT EXISTS pharmacy_stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    batch_id TEXT REFERENCES pharmacy_batches(id),
    quantity_delta NUMERIC(14, 3) NOT NULL CHECK (quantity_delta <> 0),
    reason TEXT NOT NULL,
    reference_id TEXT,
    actor_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pharmacy_stock_movements_created_idx
    ON pharmacy_stock_movements (created_at DESC);