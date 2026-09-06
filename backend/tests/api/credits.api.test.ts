import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/creditService", () => ({
  registerCredit: vi.fn(),
  registerCreditRepayment: vi.fn(),
  getCustomerAccountStatement: vi.fn(),
}));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import { registerCredit, registerCreditRepayment, getCustomerAccountStatement } from "../../src/services/creditService";
import { CreditLimitExceededError, CustomerNotFoundError } from "../../src/domain/errors";

const NEW_CUSTOMER_BODY = {
  obligationIds: ["11111111-1111-1111-1111-111111111111"],
  customer: { name: "Sra. Rojas", phone: "3001234567", type: "persona", creditLimit: "100000.00" },
  idempotencyKey: "test-key-00000001",
};

describe("POST /credits — BR-018 (any cajero grants freely) / BR-019 (limit)", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerCredit).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("BR-018: a plain cajero (not supervisor/admin) can grant credit with no extra authorization step", async () => {
    vi.mocked(registerCredit).mockResolvedValue({
      customerId: "c1",
      creditIds: ["cc1"],
      totalCredited: "12000.00",
      outstandingBalance: "12000.00",
      eventId: "ev1",
    });
    const res = await request(app)
      .post("/credits")
      .set("Authorization", "Bearer good-token")
      .send(NEW_CUSTOMER_BODY);
    expect(res.status).toBe(201);
    expect(registerCredit).toHaveBeenCalledOnce();
  });

  it("servidor cannot grant credit (least privilege — this is a cash-adjacent op)", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const res = await request(app)
      .post("/credits")
      .set("Authorization", "Bearer good-token")
      .send(NEW_CUSTOMER_BODY);
    expect(res.status).toBe(403);
  });

  it("rejects malformed customer payload (missing creditLimit for a new customer)", async () => {
    const { creditLimit: _drop, ...badCustomer } = NEW_CUSTOMER_BODY.customer as Record<string, unknown>;
    const res = await request(app)
      .post("/credits")
      .set("Authorization", "Bearer good-token")
      .send({ ...NEW_CUSTOMER_BODY, customer: badCustomer });
    expect(res.status).toBe(400);
    expect(registerCredit).not.toHaveBeenCalled();
  });

  it("BR-019: maps CreditLimitExceededError to 422", async () => {
    vi.mocked(registerCredit).mockRejectedValue(new CreditLimitExceededError("c1", "50000.00", "62000.00"));
    const res = await request(app)
      .post("/credits")
      .set("Authorization", "Bearer good-token")
      .send(NEW_CUSTOMER_BODY);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("CREDIT_LIMIT_EXCEEDED");
  });

  it("accepts referencing an existing customer by id instead of creating a new one", async () => {
    vi.mocked(registerCredit).mockResolvedValue({
      customerId: "existing-c1",
      creditIds: ["cc2"],
      totalCredited: "5000.00",
      outstandingBalance: "5000.00",
      eventId: "ev2",
    });
    const res = await request(app)
      .post("/credits")
      .set("Authorization", "Bearer good-token")
      .send({
        obligationIds: ["11111111-1111-1111-1111-111111111111"],
        customer: { id: "22222222-2222-2222-2222-222222222222" },
        idempotencyKey: "test-key-00000002",
      });
    expect(res.status).toBe(201);
  });
});

describe("POST /credits/:customerId/repayments (abonos)", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerCreditRepayment).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("passes customerId from the URL param into the service call", async () => {
    vi.mocked(registerCreditRepayment).mockResolvedValue({
      repaymentId: "rp1",
      appliedAmount: "5000.00",
      changeAmount: "0.00",
      outstandingBalance: "0.00",
      allocations: [],
      eventId: "ev3",
    });
    const res = await request(app)
      .post("/credits/cust-123/repayments")
      .set("Authorization", "Bearer good-token")
      .send({ tenders: [{ method: "efectivo", amount: "5000.00" }], idempotencyKey: "test-key-00000003" });

    expect(res.status).toBe(201);
    expect(registerCreditRepayment).toHaveBeenCalledWith(
      "u1",
      "t1",
      expect.objectContaining({ customerId: "cust-123" })
    );
  });
});

describe("GET /credits/:customerId", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(getCustomerAccountStatement).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "admin" });
  });

  it("maps CustomerNotFoundError to 404", async () => {
    vi.mocked(getCustomerAccountStatement).mockRejectedValue(new CustomerNotFoundError("cust-x"));
    const res = await request(app).get("/credits/cust-x").set("Authorization", "Bearer good-token");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("CUSTOMER_NOT_FOUND");
  });
});
