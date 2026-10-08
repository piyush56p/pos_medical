const { compileFilter } = require("../api/postgres-store");
const { requireOwner } = require("../server");

describe("compileFilter", () => {
    test("compiles equality filters with bound JSON values", () => {
        const params = [];

        expect(compileFilter({ status: 1, username: "owner" }, params, 2)).toBe(
            "document -> 'status' = $2::jsonb AND document -> 'username' = $3::jsonb",
        );
        expect(params).toEqual(["1", '"owner"']);
    });

    test("compiles nested boolean and comparison filters", () => {
        const params = [];
        const filter = {
            $and: [
                { status: 0 },
                { date: { $gte: "2026-01-01", $lte: "2026-12-31" } },
            ],
        };

        expect(compileFilter(filter, params)).toBe(
            "(document -> 'status' = $1::jsonb AND document -> 'date' >= $2::jsonb AND document -> 'date' <= $3::jsonb)",
        );
        expect(params).toEqual(["0", '"2026-01-01"', '"2026-12-31"']);
    });

    test("rejects unsupported fields and operators", () => {
        expect(() => compileFilter({ "name' OR TRUE --": "x" })).toThrow(
            "Unsupported datastore field",
        );
        expect(() => compileFilter({ quantity: { $regex: ".*" } })).toThrow(
            "Unsupported datastore operator",
        );
    });
});

describe("requireOwner", () => {
    test("rejects requests without an owner session", () => {
        const response = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        const next = jest.fn();

        requireOwner({ session: {} }, response, next);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({ error: "Authentication required." });
        expect(next).not.toHaveBeenCalled();
    });

    test("continues requests with an owner session", () => {
        const next = jest.fn();

        requireOwner({ session: { userId: "1" } }, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
    });
});