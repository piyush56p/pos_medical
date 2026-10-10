const { calculateDashboard, resolveDateRange } = require("../api/dashboard-metrics");

describe("dashboard metrics", () => {
    test("separates sale revenue, collected payments, and outstanding credit", () => {
        const metrics = calculateDashboard({
            now: new Date("2026-10-10T07:00:00Z"),
            range: { from: "2026-10-10", to: "2026-10-10", today: "2026-10-10" },
            transactions: [
                { _id: 1, status: 1, date: "2026-10-10T06:00:00Z", total: 100, paid: "30", customer: { id: "c1", name: "Asha" }, items: [{ id: 4, product_name: "Medicine", quantity: 2, price: 50 }] },
                { _id: 2, status: 0, date: "2026-10-10T06:00:00Z", total: 50, paid: "", items: [] },
            ],
            products: [{ _id: 4, category: null, stock: 1, quantity: 3, minStock: 5 }],
            batches: [{ product_id: "4", batch_number: "B-1", expiry_date: "2026-10-20", quantity: 4 }],
        });

        expect(metrics.sales.revenue).toBe(100);
        expect(metrics.sales.collected).toBe(30);
        expect(metrics.sales.creditOutstanding).toBe(70);
        expect(metrics.sales.grossProfit).toBeNull();
        expect(metrics.inventory.lowStock).toBe(1);
        expect(metrics.inventory.nearExpiryBatches).toBe(1);
        expect(metrics.inventory.attention.nearExpiryItems[0].name).toBe("Unknown product");
        expect(metrics.charts.bestSellers[0].name).toBe("Medicine");
        expect(metrics.charts.outstandingByCustomer[0]).toMatchObject({ customerName: "Asha", outstanding: 70, bills: 1 });
    });

    test("uses actual payment dates and handles empty-range charts", () => {
        const metrics = calculateDashboard({
            now: new Date("2026-10-10T07:00:00Z"),
            range: { from: "2026-10-10", to: "2026-10-10", today: "2026-10-10" },
            transactions: [{ _id: "old", status: 1, date: "2026-10-01T00:00:00Z", total: 80, items: [] }],
            payments: [{ transaction_id: "old", amount: 25, method: "upi", received_at: "2026-10-10T04:00:00Z" }],
        });
        expect(metrics.sales.revenue).toBe(0);
        expect(metrics.sales.collected).toBe(25);
        expect(metrics.charts.dailyTrend).toEqual([{ date: "2026-10-10", sales: 0, bills: 0, collected: 25 }]);
    });

    test("validates custom date ranges", () => {
        expect(resolveDateRange({ period: "custom", from: "2026-10-01", to: "2026-10-10" }).from).toBe("2026-10-01");
        expect(() => resolveDateRange({ period: "custom", from: "bad", to: "2026-10-10" })).toThrow("Custom date range");
    });
});