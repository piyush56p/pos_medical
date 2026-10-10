let app = require("express")();
let server = require("http").Server(app);
let bodyParser = require("body-parser");
const { PostgresStore } = require("./postgres-store");
const crypto = require("crypto");
const { pool } = require("./postgres-store");
let Inventory = require("./inventory");

app.use(bodyParser.json());

module.exports = app;

let transactionsDB = new PostgresStore({ collection: "transactions" });

transactionsDB.ensureIndex({ fieldName: "_id", unique: true });

function normalizePaymentMethod(method) {
  const value = String(method || "cash").trim().toLowerCase();
  if (["upi", "card", "other"].includes(value)) return value;
  return "cash";
}

function getBillStatus(total, collected, finalized = true) {
  if (!finalized) return "open";
  return collected >= total ? "paid" : "credit";
}

function collectedAmount(total, tendered, change) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeTendered = Math.max(0, Number(tendered) || 0);
  const safeChange = Math.max(0, Number(change) || 0);
  return Math.min(safeTotal, Math.max(0, safeTendered - safeChange));
}

function salePaymentBreakdown(body, total, collected) {
  if (!Array.isArray(body.payments)) {
    return collected > 0 ? [{
      method: normalizePaymentMethod(body.payment_type),
      amount: collected,
      reference: String(body.payment_info || "").slice(0, 200) || null,
    }] : [];
  }
  if (body.payments.length > 3) throw Object.assign(new Error("A bill can contain at most three split tenders."), { statusCode: 400 });
  const methods = new Set(["cash", "upi", "card"]);
  const entries = body.payments.map((entry) => {
    const method = String(entry.method || "").trim().toLowerCase();
    const amount = Math.round(Number(entry.amount) * 100) / 100;
    if (!methods.has(method) || !Number.isFinite(amount) || amount <= 0) {
      throw Object.assign(new Error("Each split tender needs a supported method and positive amount."), { statusCode: 400 });
    }
    return { method, amount, reference: String(entry.reference || "").slice(0, 200) || null };
  });
  const splitTotal = Math.round(entries.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
  if (splitTotal > total || Math.abs(splitTotal - collected) > 0.01) {
    throw Object.assign(new Error("Split payment total must match the collected amount and cannot exceed the bill."), { statusCode: 400 });
  }
  return entries;
}

async function decrementInventory(client, products, actorId, transactionId) {
  if (!Array.isArray(products)) throw Object.assign(new Error("Transaction items are invalid."), { statusCode: 400 });
  for (const item of products) {
    const productId = String(item.id ?? "");
    const quantity = Number(item.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      throw Object.assign(new Error("A transaction item has an invalid product or quantity."), { statusCode: 400 });
    }
    const found = await client.query(
      "SELECT document FROM app_records WHERE collection='inventory' AND id=$1 FOR UPDATE",
      [productId],
    );
    const product = found.rows[0] && found.rows[0].document;
    if (!product) throw Object.assign(new Error(`Product ${productId} no longer exists.`), { statusCode: 409 });
    if (Number(product.stock) !== 1) continue;

    const batchQuery = await client.query(
      `SELECT id, quantity FROM pharmacy_batches
        WHERE product_id=$1 AND quantity>0 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        AND ($2::text IS NULL OR id=$2)
       ORDER BY expiry_date ASC NULLS LAST, created_at ASC FOR UPDATE`,
      [productId, item.batch_id ? String(item.batch_id) : null],
    );
    if (item.batch_id && !batchQuery.rowCount) {
      throw Object.assign(new Error(`Selected batch for ${product.name} is no longer available.`), { statusCode: 409 });
    }
    if (batchQuery.rowCount) {
      let remaining = quantity;
      for (const batch of batchQuery.rows) {
        if (remaining <= 0) break;
        const available = Number(batch.quantity);
        const used = Math.min(available, remaining);
        await client.query("UPDATE pharmacy_batches SET quantity=quantity-$2, updated_at=NOW() WHERE id=$1", [batch.id, used]);
        await client.query(
          `INSERT INTO pharmacy_stock_movements (id,product_id,batch_id,quantity_delta,reason,reference_id,actor_id)
           VALUES ($1,$2,$3,$4,'sale',$5,$6)`,
          [crypto.randomUUID(), productId, batch.id, -used, transactionId, String(actorId)],
        );
        remaining -= used;
      }
      if (remaining > 0) throw Object.assign(new Error(`Insufficient batch stock for ${product.name}.`), { statusCode: 409 });
    } else {
      const batchRecords = await client.query(
        "SELECT 1 FROM pharmacy_batches WHERE product_id=$1 LIMIT 1",
        [productId],
      );
      if (item.batch_id || batchRecords.rowCount) {
        throw Object.assign(new Error(`No unexpired batch stock is available for ${product.name}.`), { statusCode: 409 });
      }
      const available = Number(product.quantity) || 0;
      if (available < quantity) throw Object.assign(new Error(`Insufficient stock for ${product.name}.`), { statusCode: 409 });
      await client.query(
        `INSERT INTO pharmacy_stock_movements (id,product_id,quantity_delta,reason,reference_id,actor_id)
         VALUES ($1,$2,$3,'sale',$4,$5)`,
        [crypto.randomUUID(), productId, -quantity, transactionId, String(actorId)],
      );
    }

    const updatedProduct = { ...product, quantity: (Number(product.quantity) || 0) - quantity };
    await client.query(
      "UPDATE app_records SET document=$2::jsonb WHERE collection='inventory' AND id=$1",
      [productId, JSON.stringify(updatedProduct)],
    );
  }
}

/**
 * GET endpoint: Get the welcome message for the Transactions API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
  res.send("Transactions API");
});

/**
 * GET endpoint: Get details of all transactions.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/all", function (req, res) {
  transactionsDB.find({}, function (err, docs) {
    res.send(docs);
  });
});

/**
 * GET endpoint: Get on-hold transactions.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/on-hold", function (req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: { $ne: "" } }, { status: 0 }] },
    function (err, docs) {
      if (docs) res.send(docs);
    },
  );
});

/**
 * GET endpoint: Get customer orders with a status of 0 and an empty reference number.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/customer-orders", function (req, res) {
  transactionsDB.find(
    { $and: [{ customer: { $ne: "0" } }, { status: 0 }, { ref_number: "" }] },
    function (err, docs) {
      if (docs) res.send(docs);
    },
  );
});

/**
 * GET endpoint: Get transactions based on date, user, and till parameters.
 *
 * @param {Object} req request object with query parameters.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/by-date", function (req, res) {
  let startDate = new Date(req.query.start);
  let endDate = new Date(req.query.end);

  if (req.query.user == 0 && req.query.till == 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }

  if (req.query.user != 0 && req.query.till == 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
          { user_id: parseInt(req.query.user) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }

  if (req.query.user == 0 && req.query.till != 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
          { till: parseInt(req.query.till) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }

  if (req.query.user != 0 && req.query.till != 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
          { till: parseInt(req.query.till) },
          { user_id: parseInt(req.query.user) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }
});

/**
 * POST endpoint: Create a new transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/new", async function (req, res) {
  const newTransaction = req.body;
  const transactionId = String(newTransaction._id ?? newTransaction.order ?? "");
  const total = Number(newTransaction.total);
  const finalized = Number(newTransaction.status) === 1;
  if (!transactionId || !Array.isArray(newTransaction.items) || !Number.isFinite(total) || total < 0) {
    return res.status(400).json({ error: "Transaction data is invalid." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT 1 FROM app_records WHERE collection='transactions' AND id=$1 FOR UPDATE", [transactionId]);
    if (exists.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This bill already exists. Reload it before submitting again." });
    }
    const collected = collectedAmount(total, newTransaction.paid, newTransaction.change);
    let paymentEntries = [];
    try {
      if (finalized) paymentEntries = salePaymentBreakdown(newTransaction, total, collected);
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    const bill = {
      ...newTransaction,
      _id: newTransaction._id ?? transactionId,
      status: finalized ? 1 : 0,
      billStatus: getBillStatus(total, collected, finalized),
      collected: collected.toFixed(2),
      balance: Math.max(0, total - collected).toFixed(2),
      finalizedAt: finalized ? new Date().toISOString() : null,
    };
    if (finalized) await decrementInventory(client, bill.items, req.session.userId, transactionId);
    await client.query(
      "INSERT INTO app_records (collection,id,document) VALUES ('transactions',$1,$2::jsonb)",
      [transactionId, JSON.stringify(bill)],
    );
    if (finalized) {
      for (const [index, entry] of paymentEntries.entries()) {
        await client.query(
          `INSERT INTO pharmacy_payments (id,transaction_id,amount,method,reference,idempotency_key,received_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [crypto.randomUUID(), transactionId, entry.amount, entry.method, entry.reference, `sale:${transactionId}:${index}`, String(req.session.userId)],
        );
      }
    }
    await client.query("COMMIT");
    res.sendStatus(200);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to create bill:", error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to save the bill. No stock or payment changes were committed." });
  } finally {
    client.release();
  }
});

/**
 * PUT endpoint: Update an existing transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.put("/new", async function (req, res) {
  const transactionId = String(req.body._id ?? "");
  const finalized = Number(req.body.status) === 1;
  if (!transactionId || !Array.isArray(req.body.items) || !Number.isFinite(Number(req.body.total))) {
    return res.status(400).json({ error: "Transaction data is invalid." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT document FROM app_records WHERE collection='transactions' AND id=$1 FOR UPDATE", [transactionId]);
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Open bill not found." });
    }
    if (Number(found.rows[0].document.status) === 1) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This bill is already finalized." });
    }
    const total = Number(req.body.total);
    const collected = collectedAmount(total, req.body.paid, req.body.change);
    let paymentEntries = [];
    try {
      if (finalized) paymentEntries = salePaymentBreakdown(req.body, total, collected);
    } catch (error) {
      await client.query("ROLLBACK");
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    const bill = {
      ...req.body,
      _id: found.rows[0].document._id,
      status: finalized ? 1 : 0,
      billStatus: getBillStatus(total, collected, finalized),
      collected: collected.toFixed(2),
      balance: Math.max(0, total - collected).toFixed(2),
      finalizedAt: finalized ? new Date().toISOString() : null,
    };
    if (finalized) await decrementInventory(client, bill.items, req.session.userId, transactionId);
    await client.query(
      "UPDATE app_records SET document=$2::jsonb WHERE collection='transactions' AND id=$1",
      [transactionId, JSON.stringify(bill)],
    );
    if (finalized) {
      for (const [index, entry] of paymentEntries.entries()) {
        await client.query(
          `INSERT INTO pharmacy_payments (id,transaction_id,amount,method,reference,idempotency_key,received_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [crypto.randomUUID(), transactionId, entry.amount, entry.method, entry.reference, `sale:${transactionId}:${index}`, String(req.session.userId)],
        );
      }
    }
    await client.query("COMMIT");
    res.sendStatus(200);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to update bill:", error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Unable to save the bill. No stock or payment changes were committed." });
  } finally {
    client.release();
  }
});

/**
 * POST endpoint: Delete a transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/delete", async function (req, res) {
  const transactionId = String(req.body.orderId ?? "");
  const result = await pool.query(
    "DELETE FROM app_records WHERE collection='transactions' AND id=$1 AND COALESCE(document->>'status','0')='0' RETURNING id",
    [transactionId],
  );
  if (!result.rowCount) return res.status(409).json({ error: "Only open bills can be deleted." });
  res.sendStatus(200);
});

app.get("/:transactionId/payments", async function (req, res) {
  try {
    const result = await pool.query(
      "SELECT id, amount, method, reference, received_by, received_at FROM pharmacy_payments WHERE transaction_id=$1 ORDER BY received_at",
      [String(req.params.transactionId)],
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Unable to load payment history:", error.message);
    res.status(500).json({ error: "Unable to load payment history." });
  }
});

app.post("/:transactionId/payments", async function (req, res) {
  const transactionId = String(req.params.transactionId);
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  const idempotencyKey = typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  const method = normalizePaymentMethod(req.body.method);
  if (!Number.isFinite(amount) || amount <= 0 || !idempotencyKey || idempotencyKey.length > 160) {
    return res.status(400).json({ error: "Provide a positive payment amount and idempotency key." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingPayment = await client.query(
      "SELECT transaction_id FROM pharmacy_payments WHERE idempotency_key=$1",
      [idempotencyKey],
    );
    if (existingPayment.rowCount) {
      await client.query("COMMIT");
      return res.json({ recorded: true, duplicate: true });
    }
    const billResult = await client.query(
      "SELECT document FROM app_records WHERE collection='transactions' AND id=$1 FOR UPDATE",
      [transactionId],
    );
    if (!billResult.rowCount) {
      await client.query("ROLLBACK");
      return res.sendStatus(404);
    }
    const bill = billResult.rows[0].document;
    if (Number(bill.status) !== 1 || bill.billStatus === "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only finalized credit bills can receive payments." });
    }
    const total = Number(bill.total);
    if (!Number.isFinite(total) || total <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This bill has no valid total." });
    }

    let paymentRows = await client.query(
      "SELECT COALESCE(SUM(amount),0)::numeric AS collected FROM pharmacy_payments WHERE transaction_id=$1",
      [transactionId],
    );
    let collected = Number(paymentRows.rows[0].collected);
    if (!collected) {
      collected = Math.min(total, Math.max(0, Number(bill.collected ?? bill.paid) || 0));
      if (collected > 0) {
        await client.query(
          `INSERT INTO pharmacy_payments (id,transaction_id,amount,method,idempotency_key,received_by,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (idempotency_key) DO NOTHING`,
          [crypto.randomUUID(), transactionId, collected, normalizePaymentMethod(bill.payment_type), `legacy:${transactionId}`, String(req.session.userId), JSON.stringify({ importedFromV1: true })],
        );
      }
    }
    const balance = Math.max(0, total - collected);
    if (amount > balance + 0.001) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payment exceeds the outstanding balance.", balance });
    }

    await client.query(
      `INSERT INTO pharmacy_payments (id,transaction_id,amount,method,reference,idempotency_key,received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(), transactionId, amount, method, String(req.body.reference || "").slice(0, 200) || null, idempotencyKey, String(req.session.userId)],
    );
    collected = Math.round((collected + amount) * 100) / 100;
    const updatedBill = {
      ...bill,
      paid: collected.toFixed(2),
      collected: collected.toFixed(2),
      balance: Math.max(0, total - collected).toFixed(2),
      billStatus: getBillStatus(total, collected, true),
      lastPaymentMethod: method,
    };
    await client.query(
      "UPDATE app_records SET document=$2::jsonb WHERE collection='transactions' AND id=$1",
      [transactionId, JSON.stringify(updatedBill)],
    );
    await client.query("COMMIT");
    res.status(201).json({ recorded: true, collected, balance: Math.max(0, total - collected), billStatus: updatedBill.billStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.json({ recorded: true, duplicate: true });
    console.error("Unable to record customer payment:", error.message);
    res.status(500).json({ error: "Unable to record payment; no balance changes were committed." });
  } finally {
    client.release();
  }
});

/**
 * GET endpoint: Get details of a specific transaction by transaction ID.
 *
 * @param {Object} req request object with transaction ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/:transactionId", function (req, res) {
  transactionsDB.find({ _id: req.params.transactionId }, function (err, doc) {
    if (doc) res.send(doc[0]);
  });
});

module.exports.normalizePaymentMethod = normalizePaymentMethod;
module.exports.getBillStatus = getBillStatus;
module.exports.collectedAmount = collectedAmount;
module.exports.salePaymentBreakdown = salePaymentBreakdown;
