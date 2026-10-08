CREATE TABLE IF NOT EXISTS app_records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    document JSONB NOT NULL,
    sequence BIGSERIAL,
    PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS app_records_collection_sequence_idx
    ON app_records (collection, sequence);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique_idx
    ON app_records ((document ->> 'username'))
    WHERE collection = 'users';