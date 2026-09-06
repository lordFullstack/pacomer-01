import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/supplierService", () => ({
  registerPurchase: vi.fn(),
  registerSupplierPayment: vi.fn(),
  getSupplierAccountStatement: vi.fn(),
}));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import { registerPurchase, registerSupplierPayment } from "../../src/services/supplierService";
import { SupplierPaymentExceedsBalanceError } from "../../src/domain/errors";

describe("POST /suppliers/purchases — BR-021 cuenta acumulada", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerPurchase).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("registers a purchase for a new supplier", async () => {
    vi.mocked(registerPurchase).mockResolvedValue({
      supplierId: "s1",
      purchaseId: "pu1",
      outstandingBalance: "80000.00",
      eventId: "ev1",
    });
    const res = await request(app)
      .post("/suppliers/purchases")
      .set("Authorization", "Bearer good-token")
      .send({
        supplier: { name: "Carnicería Don Pepe", paymentTerms: "semanal" },
        amount: "80000.00",
        idempotencyKey: "test-key-00000001",
      });
    expect(res.status).toBe(201);
    expect(res.body.outstandingBalance).toBe("80000.00");
  });

  it("servidor cannot register a purchase", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const res = await request(app)
      .post("/suppliers/purchases")
      .set("Authorization", "Bearer good-token")
      .send({
        supplier: { name: "Carnicería Don Pepe", paymentTerms: "semanal" },
        amount: "80000.00",
        idempotencyKey: "test-key-00000001",
      });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid paymentTerms value", async () => {
    const res = await request(app)
      .post("/suppliers/purchases")
      .set("Authorization", "Bearer good-token")
      .send({
        supplier: { name: "X", paymentTerms: "mensual" }, // not in ('contado','semanal','quincenal')
        amount: "1000.00",
        idempotencyKey: "test-key-00000001",
      });
    expect(res.status).toBe(400);
  });
});

describe("POST /suppliers/:id/payments — no 'change' concept for suppliers", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerSupplierPayment).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("maps SupplierPaymentExceedsBalanceError to 422 — you cannot overpay a supplier", async () => {
    vi.mocked(registerSupplierPayment).mockRejectedValue(
      new SupplierPaymentExceedsBalanceError("50000.00", "80000.00")
    );
    const res = await request(app)
      .post("/suppliers/sup-1/payments")
      .set("Authorization", "Bearer good-token")
      .send({ tenders: [{ method: "efectivo", amount: "80000.00" }], idempotencyKey: "test-key-00000002" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("SUPPLIER_PAYMENT_EXCEEDS_BALANCE");
  });
});
