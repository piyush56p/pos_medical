const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { initializeDatabase, pool } = require("./api/postgres-store");

const app = express();
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "public", "uploads");
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
});

app.set("trust proxy", 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
        },
    },
}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
    },
}));

function requireOwner(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: "Authentication required." });
    }
    next();
}

async function ensureOwnerAccount() {
    const existing = await pool.query(
        "SELECT id, document FROM app_records WHERE collection = 'users' ORDER BY sequence LIMIT 1",
    );
    const username = process.env.OWNER_USERNAME && process.env.OWNER_USERNAME.trim();
    const password = process.env.OWNER_PASSWORD;
    if (!username || !password || password.length < 12) {
        throw new Error("Set OWNER_USERNAME and an OWNER_PASSWORD of at least 12 characters.");
    }

    const existingOwner = existing.rows[0];
    const owner = {
        ...(existingOwner ? existingOwner.document : {}),
        _id: existingOwner ? existingOwner.document._id : 1,
        username,
        fullname: process.env.OWNER_NAME || (existingOwner && existingOwner.document.fullname) || "PharmaSpot Owner",
        password: await bcrypt.hash(password, 12),
        perm_products: 1,
        perm_categories: 1,
        perm_transactions: 1,
        perm_users: 1,
        perm_settings: 1,
        status: "",
    };
    if (existingOwner) {
        await pool.query(
            "UPDATE app_records SET document = $2::jsonb WHERE collection = 'users' AND id = $1",
            [existingOwner.id, JSON.stringify(owner)],
        );
    } else {
        await pool.query(
            `INSERT INTO app_records (collection, id, document)
             VALUES ('users', '1', $1::jsonb)`,
            [JSON.stringify(owner)],
        );
    }
}

app.get("/healthz", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok" });
    } catch (error) {
        res.status(503).json({ status: "unavailable" });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/uploads", requireOwner, express.static(uploadsDir));

app.use("/api", (req, res, next) => {
    if (req.path === "/users/login" && req.method === "POST") {
        return next();
    }
    return requireOwner(req, res, next);
});
app.get("/api/session", requireOwner, (req, res) => {
    res.json(req.session.user);
});
app.use("/api/users/login", loginLimiter);
app.use("/api/inventory", require("./api/inventory"));
app.use("/api/customers", require("./api/customers"));
app.use("/api/categories", require("./api/categories"));
app.use("/api/settings", require("./api/settings"));
app.use("/api/imports", require("./api/imports"));
app.use("/api/dashboard", require("./api/dashboard"));
app.use("/api/users", require("./api/users"));
app.use("/api", require("./api/transactions"));

async function startServer() {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        throw new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
    }
    fs.mkdirSync(uploadsDir, { recursive: true });
    await initializeDatabase();
    await ensureOwnerAccount();
    const port = Number(process.env.PORT || 3210);
    return app.listen(port, () => {
        console.log(`Listening on PORT ${port}`);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error("Unable to start PharmaSpot web server:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { app, startServer, requireOwner };