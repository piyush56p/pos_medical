const TIME_ZONE = "Asia/Kolkata";

function localDate(value, timeZone = TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function resolveDateRange({ period = "30d", from, to, now = new Date() } = {}) {
    const today = localDate(now);
    if (period === "custom") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) {
            throw new TypeError("Custom date range must include valid from and to dates.");
        }
        if (addDays(from, 366) < to) throw new TypeError("Date range cannot exceed 366 days.");
        return { from, to, today };
    }
    if (period === "today") return { from: today, to: today, today };
    if (period === "yesterday") {
        const yesterday = addDays(today, -1);
        return { from: yesterday, to: yesterday, today };
    }
    if (period === "7d") return { from: addDays(today, -6), to: today, today };
    if (period === "30d") return { from: addDays(today, -29), to: today, today };
    throw new TypeError("Unsupported dashboard date range.");
}

function isFinalized(transaction) {
    return Number(transaction.status) === 1 || ["paid", "credit"].includes(transaction.billStatus);
}

function calculateDashboard({ transactions = [], recentTransactions = null, allTimeCreditOverride = null, payments = [], products = [], batches = [], imports = [], range, now = new Date(), nearExpiryDays = 30 }) {
    const { from, to, today } = range || resolveDateRange({ now });
    const paymentMap = new Map();
    const collectionsByDate = new Map();
    const methodTotals = new Map();
    for (const payment of payments) {
        const amount = Number(payment.amount) || 0;
        if (amount <= 0) continue;
        const transactionId = String(payment.transaction_id);
        paymentMap.set(transactionId, (paymentMap.get(transactionId) || 0) + amount);
        const date = localDate(payment.received_at);
        if (date >= from && date <= to) {
            collectionsByDate.set(date, (collectionsByDate.get(date) || 0) + amount);
            const method = String(payment.method || "other").toLowerCase();
            methodTotals.set(method, (methodTotals.get(method) || 0) + amount);
        }
    }

    const salesByDate = new Map();
    const billsByDate = new Map();
    const productsById = new Map(products.map((product) => [String(product._id), product]));
    const bestSellers = new Map();
    const categorySales = new Map();
    const creditByCustomer = new Map();
    let salesRevenue = 0;
    let collectedInRange = 0;
    let billCount = 0;
    let todaySales = 0;
    let todayBills = 0;
    let creditOutstanding = 0;
    let weekSales = 0;
    let monthSales = 0;
    let allTimeCredit = 0;

    for (const transaction of transactions) {
        if (!isFinalized(transaction)) continue;
        const total = Number(transaction.total) || 0;
        const transactionId = String(transaction._id);
        const transactionDate = localDate(transaction.date || transaction.finalizedAt || now);
        const hasLedgerPayments = paymentMap.has(transactionId);
        const legacyCollected = Math.min(total, Math.max(0,
            Number(transaction.collected ?? transaction.paid) - (Number(transaction.change) || 0),
        ));
        const collected = hasLedgerPayments ? paymentMap.get(transactionId) : legacyCollected;
        const outstanding = Math.max(0, total - collected);
        allTimeCredit += outstanding;
        if (outstanding > 0) {
            const customer = transaction.customer && typeof transaction.customer === "object" ? transaction.customer : null;
            const customerId = customer ? String(customer.id ?? customer._id ?? "unknown") : "walk-in";
            const customerName = customer ? String(customer.name || customer.username || "Customer") : "Walk-in customer";
            const credit = creditByCustomer.get(customerId) || { customerId, customerName, outstanding: 0, bills: 0 };
            credit.outstanding += outstanding;
            credit.bills += 1;
            creditByCustomer.set(customerId, credit);
        }
        if (transactionDate === today) creditOutstanding += outstanding;
        if (transactionDate === today) {
            todaySales += total;
            todayBills += 1;
        }
        if (transactionDate >= addDays(today, -6) && transactionDate <= today) weekSales += total;
        if (transactionDate.slice(0, 7) === today.slice(0, 7)) monthSales += total;
        if (transactionDate < from || transactionDate > to) continue;

        salesRevenue += total;
        billCount += 1;
        salesByDate.set(transactionDate, (salesByDate.get(transactionDate) || 0) + total);
        billsByDate.set(transactionDate, (billsByDate.get(transactionDate) || 0) + 1);
        if (!hasLedgerPayments && legacyCollected > 0) {
            const method = String(transaction.payment_type || "other").toLowerCase();
            methodTotals.set(method, (methodTotals.get(method) || 0) + legacyCollected);
            collectionsByDate.set(transactionDate, (collectionsByDate.get(transactionDate) || 0) + legacyCollected);
        }
        for (const item of transaction.items || []) {
            const quantity = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            const key = String(item.id || item.product_name || "unknown");
            const current = bestSellers.get(key) || { id: key, name: item.product_name || "Unknown product", quantity: 0, revenue: 0 };
            current.quantity += quantity;
            current.revenue += quantity * price;
            bestSellers.set(key, current);
            const product = productsById.get(String(item.id));
            const category = product && product.category && String(product.category) !== "0" ? String(product.category) : null;
            if (category) categorySales.set(category, (categorySales.get(category) || 0) + quantity * price);
        }
    }

    for (const [date, amount] of collectionsByDate) {
        if (date >= from && date <= to) collectedInRange += amount;
    }
    const collectedToday = collectionsByDate.get(today) || 0;
    // Legacy collection values are added above; avoid double-counting those in the map.
    const dailyTrend = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
        dailyTrend.push({ date, sales: salesByDate.get(date) || 0, bills: billsByDate.get(date) || 0, collected: collectionsByDate.get(date) || 0 });
    }

    let nearExpiryBatches = 0;
    let expiredBatches = 0;
    const nearExpiryItems = [];
    const expiredItems = [];
    for (const batch of batches) {
        const quantity = Number(batch.quantity) || 0;
        if (quantity <= 0 || !batch.expiry_date) continue;
        const expiry = String(batch.expiry_date).slice(0, 10);
        const product = productsById.get(String(batch.product_id));
        const item = { productId: String(batch.product_id), name: product && product.name ? product.name : "Unknown product", batchNumber: batch.batch_number, expiryDate: expiry, quantity };
        if (expiry < today) {
            expiredBatches += 1;
            expiredItems.push(item);
        } else if (expiry <= addDays(today, nearExpiryDays)) {
            nearExpiryBatches += 1;
            nearExpiryItems.push(item);
        }
    }
    const lowStockProducts = products.filter((product) => Number(product.stock) === 1 && Number(product.quantity) > 0 && Number(product.quantity) <= (Number(product.minStock) || 0));
    const outOfStockProducts = products.filter((product) => Number(product.stock) === 1 && Number(product.quantity) <= 0);

    return {
        currency: "INR",
        timeZone: TIME_ZONE,
        range: { from, to },
        sales: {
            revenue: salesRevenue,
            billCount,
            collected: collectedInRange,
            todayRevenue: todaySales,
            todayBills,
            todayCollected: collectedToday,
            averageBill: billCount ? salesRevenue / billCount : 0,
            creditOutstanding: allTimeCreditOverride === null ? allTimeCredit : Number(allTimeCreditOverride) || 0,
            todayCreditOutstanding: creditOutstanding,
            last7Days: weekSales,
            thisMonth: monthSales,
            grossProfit: null,
            grossProfitUnavailableReason: "Purchase cost and historical returns are not yet consistently recorded for all V1 sales.",
        },
        inventory: {
            products: products.length,
            trackedBatches: batches.length,
            lowStock: lowStockProducts.length,
            outOfStock: outOfStockProducts.length,
            nearExpiryBatches,
            expiredBatches,
            lowStockThreshold: "Product minStock setting",
            nearExpiryThresholdDays: nearExpiryDays,
            attention: {
                lowStockProducts: lowStockProducts.map((product) => ({ id: product._id, name: product.name, quantity: Number(product.quantity), minStock: Number(product.minStock) || 0 })),
                outOfStockProducts: outOfStockProducts.map((product) => ({ id: product._id, name: product.name, quantity: Number(product.quantity) || 0 })),
                nearExpiryItems,
                expiredItems,
            },
        },
        charts: {
            dailyTrend,
            paymentMethods: [...methodTotals].map(([method, amount]) => ({ method, amount })),
            bestSellers: [...bestSellers.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
            categorySales: [...categorySales].map(([category, revenue]) => ({ category, revenue })),
            outstandingByCustomer: [...creditByCustomer.values()].sort((a, b) => b.outstanding - a.outstanding).slice(0, 10),
        },
        recent: {
            transactions: [...(recentTransactions || transactions)].sort((a, b) => String(b.date || b.finalizedAt || "").localeCompare(String(a.date || a.finalizedAt || ""))).slice(0, 10),
            payments: [...payments].sort((a, b) => String(b.received_at || "").localeCompare(String(a.received_at || ""))).slice(0, 10),
            imports: imports.slice(0, 10),
        },
    };
}

module.exports = { calculateDashboard, isFinalized, localDate, resolveDateRange };
