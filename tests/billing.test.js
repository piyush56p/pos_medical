const { collectedAmount, getBillStatus, normalizePaymentMethod, salePaymentBreakdown } = require("../api/transactions");

describe("pharmacy bill lifecycle", () => {
    test("distinguishes open, credit, and paid bills", () => {
        expect(getBillStatus(100, 0, false)).toBe("open");
        expect(getBillStatus(100, 20, true)).toBe("credit");
        expect(getBillStatus(100, 100, true)).toBe("paid");
    });

    test("normalizes supported payment methods", () => {
        expect(normalizePaymentMethod("UPI")).toBe("upi");
        expect(normalizePaymentMethod("Card")).toBe("card");
        expect(normalizePaymentMethod("Cash")).toBe("cash");
        expect(normalizePaymentMethod("unknown")).toBe("cash");
    });

    test("subtracts change from tendered cash before recording collections", () => {
        expect(collectedAmount(100, 120, 20)).toBe(100);
        expect(collectedAmount(100, 40, 0)).toBe(40);
        expect(collectedAmount(100, "", "")).toBe(0);
    });

    test("records split tenders separately and rejects overpayment", () => {
        const payments = salePaymentBreakdown({
            payments: [
                { method: "cash", amount: 25 },
                { method: "upi", amount: 50 },
            ],
        }, 100, 75);
        expect(payments).toEqual([
            { method: "cash", amount: 25, reference: null },
            { method: "upi", amount: 50, reference: null },
        ]);
        expect(() => salePaymentBreakdown({ payments: [{ method: "card", amount: 101 }] }, 100, 100)).toThrow(
            "Split payment total must match the collected amount and cannot exceed the bill.",
        );
    });
});