const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
});

function compileFilter(filter = {}, params = [], parameterOffset = 1) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
        throw new TypeError("A datastore filter must be an object.");
    }

    const nextParameter = (value) => {
        params.push(JSON.stringify(value));
        return `$${parameterOffset + params.length - 1}::jsonb`;
    };

    const clauses = Object.entries(filter).map(([key, value]) => {
        if (key === "$and" || key === "$or") {
            if (!Array.isArray(value)) {
                throw new TypeError(`${key} must be an array.`);
            }
            if (value.length === 0) {
                return key === "$and" ? "TRUE" : "FALSE";
            }
            const joiner = key === "$and" ? " AND " : " OR ";
            return `(${value.map((item) => compileFilter(item, params, parameterOffset)).join(joiner)})`;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(key)) {
            throw new TypeError(`Unsupported datastore field: ${key}`);
        }

        const field = `document -> '${key}'`;
        if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
            const operators = Object.entries(value);
            if (operators.some(([operator]) => !["$ne", "$gte", "$lte", "$gt", "$lt", "$in"].includes(operator))) {
                throw new TypeError(`Unsupported datastore operator for ${key}.`);
            }
            return operators.map(([operator, operand]) => {
                if (operator === "$in") {
                    if (!Array.isArray(operand)) {
                        throw new TypeError("$in must be an array.");
                    }
                    if (operand.length === 0) {
                        return "FALSE";
                    }
                    const choices = operand.map(nextParameter).join(", ");
                    return `${field} IN (${choices})`;
                }
                const sqlOperator = {
                    "$ne": "<>",
                    "$gte": ">=",
                    "$lte": "<=",
                    "$gt": ">",
                    "$lt": "<",
                }[operator];
                const comparison = `${field} ${sqlOperator} ${nextParameter(operand)}`;
                return operator === "$ne" ? `(${field} IS NULL OR ${comparison})` : comparison;
            }).join(" AND ");
        }

        return `${field} = ${nextParameter(value)}`;
    });

    return clauses.length === 0 ? "TRUE" : clauses.join(" AND ");
}

function execute(promise, callback) {
    if (typeof callback === "function") {
        promise.then((result) => callback(null, result)).catch(callback);
        return undefined;
    }
    return promise;
}

class PostgresStore {
    constructor({ collection }) {
        if (!collection) {
            throw new TypeError("A collection name is required.");
        }
        this.collection = collection;
    }

    ensureIndex() {
        return Promise.resolve();
    }

    find(filter = {}, callback) {
        const params = [this.collection];
        const where = compileFilter(filter, params, 2);
        const promise = pool.query(
            `SELECT document FROM app_records
             WHERE collection = $1 AND (${where})
             ORDER BY sequence`,
            params,
        ).then(({ rows }) => rows.map((row) => row.document));
        return execute(promise, callback);
    }

    findOne(filter = {}, callback) {
        const promise = this.find(filter).then((documents) => documents[0] || null);
        return execute(promise, callback);
    }

    insert(document, callback) {
        const record = { ...document };
        if (record._id === undefined || record._id === null) {
            record._id = crypto.randomUUID();
        }
        const promise = pool.query(
            `INSERT INTO app_records (collection, id, document)
             VALUES ($1, $2, $3::jsonb)
             RETURNING document`,
            [this.collection, String(record._id), JSON.stringify(record)],
        ).then(({ rows }) => rows[0].document);
        return execute(promise, callback);
    }

    update(filter, update, options, callback) {
        if (typeof options === "function") {
            callback = options;
        }
        const params = [this.collection];
        const where = compileFilter(filter, params, 2);
        const promise = pool.connect().then(async (client) => {
            try {
                await client.query("BEGIN");
                const { rows } = await client.query(
                    `SELECT id, document FROM app_records
                     WHERE collection = $1 AND (${where})
                     ORDER BY sequence`,
                    params,
                );
                const updated = rows.slice(0, options && options.multi ? rows.length : 1);
                for (const row of updated) {
                    const document = update && update.$set
                        ? { ...row.document, ...update.$set }
                        : { ...update };
                    if (document._id === undefined) {
                        document._id = row.document._id;
                    }
                    await client.query(
                        `UPDATE app_records SET document = $3::jsonb
                         WHERE collection = $1 AND id = $2`,
                        [this.collection, row.id, JSON.stringify(document)],
                    );
                }
                await client.query("COMMIT");
                return [updated.length, updated.map((row) => row.document)];
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        });
        return execute(promise, (error, result) => {
            if (typeof callback === "function") {
                callback(error, ...(result || []));
            }
        });
    }

    remove(filter, options, callback) {
        if (typeof options === "function") {
            callback = options;
        }
        const params = [this.collection];
        const where = compileFilter(filter, params, 2);
        const promise = pool.query(
            `DELETE FROM app_records
             WHERE collection = $1 AND (${where})
             RETURNING id`,
            params,
        ).then(({ rowCount }) => rowCount);
        return execute(promise, callback);
    }
}

async function initializeDatabase() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL must be set to use the hosted database.");
    }
    const schema = fs.readFileSync(path.join(__dirname, "postgres-schema.sql"), "utf8");
    await pool.query(schema);
}

function closeDatabase() {
    return pool.end();
}

module.exports = { PostgresStore, compileFilter, initializeDatabase, closeDatabase, pool };