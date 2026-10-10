const express = require("express");
const crypto = require("crypto");
const { pool } = require("./postgres-store");

const router = express.Router();
const locationTypes = ["section", "rack", "shelf", "bin"];
const parentType = { section: null, rack: "section", shelf: "rack", bin: "shelf" };

function makeLocationTree(rows) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const pathFor = (location) => {
        const parts = [];
        let current = location;
        while (current) {
            parts.unshift(current.name);
            current = current.parent_id ? byId.get(current.parent_id) : null;
        }
        return parts.join(" / ");
    };
    return rows.map((row) => ({ ...row, path: pathFor(row) }));
}

function canManageLocations(req) {
    const user = req.session && req.session.user;
    return user && (Number(user._id) === 1 || Number(user.perm_users) === 1);
}

function requireLocationAdmin(req, res, next) {
    if (!canManageLocations(req)) return res.status(403).json({ error: "Administrator permission is required to manage stock locations." });
    next();
}

router.get("/", async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT l.id, l.name, l.location_type, l.parent_id, l.active, l.created_at,
                    COALESCE(SUM(sl.quantity), 0)::numeric AS assigned_quantity,
                    COUNT(DISTINCT sl.product_id)::int AS product_count
             FROM pharmacy_locations l
             LEFT JOIN pharmacy_stock_locations sl ON sl.location_id = l.id
             GROUP BY l.id ORDER BY l.location_type, l.name`,
        );
        res.json(makeLocationTree(rows));
    } catch (error) {
        console.error("Unable to list pharmacy locations:", error.message);
        res.status(500).json({ error: "Unable to load pharmacy locations." });
    }
});

router.get("/product/:productId", async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT sl.id, sl.product_id, sl.batch_id, sl.location_id, sl.quantity,
                    l.name, l.location_type, l.parent_id, l.active,
                    b.batch_number, b.expiry_date
             FROM pharmacy_stock_locations sl
             JOIN pharmacy_locations l ON l.id = sl.location_id
             LEFT JOIN pharmacy_batches b ON b.id = sl.batch_id
             WHERE sl.product_id = $1 ORDER BY l.name, b.expiry_date NULLS LAST`,
            [String(req.params.productId)],
        );
        const locations = await pool.query("SELECT id,name,location_type,parent_id,active FROM pharmacy_locations");
        const paths = new Map(makeLocationTree(locations.rows).map((row) => [row.id, row.path]));
        res.json(rows.map((row) => ({ ...row, location_path: paths.get(row.location_id) || "Location not assigned" })));
    } catch (error) {
        console.error("Unable to load product locations:", error.message);
        res.status(500).json({ error: "Unable to load product locations." });
    }
});

router.post("/", requireLocationAdmin, async (req, res) => {
    const name = String(req.body.name || "").trim();
    const type = String(req.body.type || "").trim().toLowerCase();
    const parentId = req.body.parentId ? String(req.body.parentId) : null;
    if (!name || name.length > 80) return res.status(400).json({ error: "Location name must be between 1 and 80 characters." });
    if (!locationTypes.includes(type)) return res.status(400).json({ error: "Choose section, rack, shelf, or bin." });
    if ((type === "section" && parentId) || (type !== "section" && !parentId)) {
        return res.status(400).json({ error: type === "section" ? "A section cannot have a parent." : `Select a parent ${parentType[type]}.` });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (parentId) {
            const parent = await client.query("SELECT location_type,active FROM pharmacy_locations WHERE id=$1 FOR UPDATE", [parentId]);
            if (!parent.rowCount || !parent.rows[0].active || parent.rows[0].location_type !== parentType[type]) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: `Choose an active ${parentType[type]} as the parent.` });
            }
        }
        const id = crypto.randomUUID();
        const { rows } = await client.query(
            `INSERT INTO pharmacy_locations(id,name,location_type,parent_id,created_by)
             VALUES($1,$2,$3,$4,$5) RETURNING id,name,location_type,parent_id,active,created_at`,
            [id, name, type, parentId, String(req.session.userId)],
        );
        await client.query(
            `INSERT INTO pharmacy_audit_log(id,actor_id,action,entity_type,entity_id,after_state)
             VALUES($1,$2,'location.created','location',$3,$4::jsonb)`,
            [crypto.randomUUID(), String(req.session.userId), id, JSON.stringify(rows[0])],
        );
        await client.query("COMMIT");
        res.status(201).json(rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Unable to create pharmacy location:", error.message);
        res.status(500).json({ error: "Unable to create pharmacy location." });
    } finally {
        client.release();
    }
});

router.put("/:id", requireLocationAdmin, async (req, res) => {
    const name = req.body.name === undefined ? undefined : String(req.body.name).trim();
    const active = req.body.active === undefined ? undefined : req.body.active === true;
    if (name !== undefined && (!name || name.length > 80)) return res.status(400).json({ error: "Location name must be between 1 and 80 characters." });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const found = await client.query("SELECT * FROM pharmacy_locations WHERE id=$1 FOR UPDATE", [req.params.id]);
        if (!found.rowCount) {
            await client.query("ROLLBACK");
            return res.sendStatus(404);
        }
        const before = found.rows[0];
        if (active === false) {
            const occupied = await client.query(
                `SELECT 1 FROM pharmacy_stock_locations WHERE location_id=$1 LIMIT 1`,
                [req.params.id],
            );
            const children = await client.query("SELECT 1 FROM pharmacy_locations WHERE parent_id=$1 AND active=TRUE LIMIT 1", [req.params.id]);
            if (occupied.rowCount || children.rowCount) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "Move assigned stock and deactivate child locations before archiving this location." });
            }
        }
        const { rows } = await client.query(
            `UPDATE pharmacy_locations SET name=COALESCE($2,name), active=COALESCE($3,active), updated_at=NOW()
             WHERE id=$1 RETURNING id,name,location_type,parent_id,active,created_at`,
            [req.params.id, name === undefined ? null : name, active === undefined ? null : active],
        );
        await client.query(
            `INSERT INTO pharmacy_audit_log(id,actor_id,action,entity_type,entity_id,before_state,after_state)
             VALUES($1,$2,'location.updated','location',$3,$4::jsonb,$5::jsonb)`,
            [crypto.randomUUID(), String(req.session.userId), req.params.id, JSON.stringify(before), JSON.stringify(rows[0])],
        );
        await client.query("COMMIT");
        res.json(rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Unable to update pharmacy location:", error.message);
        res.status(500).json({ error: "Unable to update pharmacy location." });
    } finally {
        client.release();
    }
});

router.put("/product/:productId/stock", requireLocationAdmin, async (req, res) => {
    const productId = String(req.params.productId);
    const batchId = req.body.batchId ? String(req.body.batchId) : null;
    const assignments = Array.isArray(req.body.assignments) ? req.body.assignments : null;
    if (!assignments || assignments.length > 50) return res.status(400).json({ error: "Provide up to 50 location assignments." });
    const normalized = assignments.map((row) => ({
        locationId: String(row.locationId || ""),
        quantity: Number(row.quantity),
    }));
    if (normalized.some((row) => !row.locationId || !Number.isFinite(row.quantity) || row.quantity <= 0)) {
        return res.status(400).json({ error: "Each assigned location needs a valid location and positive quantity." });
    }
    if (new Set(normalized.map((row) => row.locationId)).size !== normalized.length) {
        return res.status(400).json({ error: "Use each location once for a product or batch." });
    }
    const requested = normalized.reduce((sum, row) => sum + row.quantity, 0);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const productResult = await client.query(
            "SELECT document FROM app_records WHERE collection='inventory' AND id=$1 FOR UPDATE",
            [productId],
        );
        if (!productResult.rowCount) {
            await client.query("ROLLBACK");
            return res.sendStatus(404);
        }
        const product = productResult.rows[0].document;
        if (Number(product.stock) !== 1) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Enable stock tracking before assigning physical stock locations." });
        }
        let available = Number(product.quantity) || 0;
        if (batchId) {
            const batch = await client.query("SELECT quantity,product_id FROM pharmacy_batches WHERE id=$1 FOR UPDATE", [batchId]);
            if (!batch.rowCount || String(batch.rows[0].product_id) !== productId) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Selected batch does not belong to this medicine." });
            }
            available = Number(batch.rows[0].quantity) || 0;
        } else {
            const hasBatches = await client.query("SELECT 1 FROM pharmacy_batches WHERE product_id=$1 LIMIT 1", [productId]);
            if (hasBatches.rowCount) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Choose a batch before assigning locations for this medicine." });
            }
        }
        if (requested > available + 0.0001) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: `Assigned quantity cannot exceed the ${available} units available in this stock pool.` });
        }
        if (normalized.length) {
            const valid = await client.query(
                "SELECT id FROM pharmacy_locations WHERE active=TRUE AND id=ANY($1::text[]) FOR UPDATE",
                [normalized.map((row) => row.locationId)],
            );
            if (valid.rowCount !== normalized.length) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "One or more selected locations are inactive or unavailable." });
            }
        }
        const prior = await client.query(
            "SELECT location_id,quantity FROM pharmacy_stock_locations WHERE product_id=$1 AND batch_id IS NOT DISTINCT FROM $2::text FOR UPDATE",
            [productId, batchId],
        );
        await client.query("DELETE FROM pharmacy_stock_locations WHERE product_id=$1 AND batch_id IS NOT DISTINCT FROM $2::text", [productId, batchId]);
        for (const row of normalized) {
            await client.query(
                `INSERT INTO pharmacy_stock_locations(id,product_id,batch_id,location_id,quantity,assigned_by)
                 VALUES($1,$2,$3,$4,$5,$6)`,
                [crypto.randomUUID(), productId, batchId, row.locationId, row.quantity, String(req.session.userId)],
            );
        }
        await client.query(
            `INSERT INTO pharmacy_audit_log(id,actor_id,action,entity_type,entity_id,before_state,after_state)
             VALUES($1,$2,'stock.locations_assigned','product',$3,$4::jsonb,$5::jsonb)`,
            [crypto.randomUUID(), String(req.session.userId), productId, JSON.stringify(prior.rows), JSON.stringify(normalized)],
        );
        await client.query("COMMIT");
        res.json({ productId, batchId, assigned: normalized, unassignedQuantity: Math.max(0, available - requested) });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Unable to assign stock locations:", error.message);
        res.status(500).json({ error: "Unable to save stock locations." });
    } finally {
        client.release();
    }
});

module.exports = router;
