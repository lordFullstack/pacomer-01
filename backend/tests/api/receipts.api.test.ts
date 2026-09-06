import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/receiptService", () => ({
  issueReceipt: vi.fn(),
  getReceipt: vi.fn(),
}));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import { issueReceipt, getReceipt } from "../../src/services/receiptService";
import { ObligationNotYetPaidError } from "../../src/domain/errors";

describe("POST /receipts — BR-024 operational (non-fiscal) receipt", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(issueReceipt).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("issues a receipt for a paid obligation", async () => {
    vi.mocked(issueReceipt).mockResolvedValue({
      id: "r1",
      tenantId: "t1",
      sequentialNumber: 42,
      obligationIds: ["ob1"],
      amount: "12000.00",
      customerName: null,
      customerIdNumber: null,
      issuedByUserId: "u1",
      issuedAt: "2026-01-01T00:00:00.000Z",
      eventId: "ev1",
    });
    const res = await request(app)
      .post("/receipts")
      .set("Authorization", "Bearer good-token")
      .send({ obligationIds: ["11111111-1111-1111-1111-111111111111"], idempotencyKey: "test-key-00000001" });
    expect(res.status).toBe(201);
    expect(res.body.sequentialNumber).toBe(42);
  });

  it("maps ObligationNotYetPaidError to 409 — can't issue a receipt for money that never moved", async () => {
    vi.mocked(issueReceipt).mockRejectedValue(new ObligationNotYetPaidError("ob1"));
    const res = await request(app)
      .post("/receipts")
      .set("Authorization", "Bearer good-token")
      .send({ obligationIds: ["11111111-1111-1111-1111-111111111111"], idempotencyKey: "test-key-00000001" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("OBLIGATION_NOT_YET_PAID");
  });
});

describe("GET /receipts/:id", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(getReceipt).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "admin" });
  });

  it("returns 404 when the receipt doesn't exist (getReceipt resolves null, not a throw)", async () => {
    vi.mocked(getReceipt).mockResolvedValue(null);
    const res = await request(app).get("/receipts/does-not-exist").set("Authorization", "Bearer good-token");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("RECEIPT_NOT_FOUND");
  });
});
