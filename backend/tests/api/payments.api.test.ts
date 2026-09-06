import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/paymentService", () => ({
  registerPayment: vi.fn(),
}));
vi.mock("../../src/services/voidService", () => ({
  requestVoid: vi.fn(),
  authorizeVoid: vi.fn(),
}));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import { registerPayment } from "../../src/services/paymentService";
import { requestVoid, authorizeVoid } from "../../src/services/voidService";
import { ObligationAlreadySettledError, ChangeExceedsCashTenderError } from "../../src/domain/errors";

const VALID_BODY = {
  obligationIds: ["11111111-1111-1111-1111-111111111111"],
  tenders: [{ method: "efectivo", amount: "10000.00" }],
  idempotencyKey: "test-key-00000001",
};

describe("POST /payments — API wiring", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerPayment).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("rejects with 422 when a 'credito' tender is sent (BR-014)", async () => {
    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send({ ...VALID_BODY, tenders: [{ method: "credito", amount: "10000.00" }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("CREDIT_REQUIRES_SEPARATE_ENDPOINT");
    expect(registerPayment).not.toHaveBeenCalled();
  });

  it("maps ObligationAlreadySettledError to HTTP 409 with its error code", async () => {
    vi.mocked(registerPayment).mockRejectedValue(new ObligationAlreadySettledError("ob-1"));

    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("OBLIGATION_ALREADY_SETTLED");
  });

  it("maps ChangeExceedsCashTenderError to HTTP 422", async () => {
    vi.mocked(registerPayment).mockRejectedValue(new ChangeExceedsCashTenderError());

    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("CHANGE_EXCEEDS_CASH_TENDER");
  });

  it("rejects with 403 for role 'servidor' (payments are cajero+ only)", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  it("allows role 'supervisor' (BR-017 scope creep check)", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "supervisor" });
    vi.mocked(registerPayment).mockResolvedValue({
      paymentId: "p1",
      appliedAmount: "10000.00",
      changeAmount: "0.00",
      allocations: [],
      eventId: "ev1",
    });
    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);
    expect(res.status).toBe(201);
  });

  it("returns 500 with a generic body for an unexpected (non-DomainError) throw — never leaks internals", async () => {
    vi.mocked(registerPayment).mockRejectedValue(new Error("something exploded inside pg"));
    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INTERNAL_ERROR");
    expect(res.body.message).not.toContain("pg"); // must not leak the raw internal error text
  });
});

describe("Void flow — BR-015/BR-016/BR-017 role gating", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(requestVoid).mockReset();
    vi.mocked(authorizeVoid).mockReset();
  });

  it("cajero can request a void", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
    vi.mocked(requestVoid).mockResolvedValue({
      id: "vr1",
      tenantId: "t1",
      paymentId: "p1",
      status: "PENDING_AUTHORIZATION",
      reason: "cliente se fue sin pagar completo",
      requestedByUserId: "u1",
      authorizedByUserId: null,
      requestedAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: null,
    });
    const res = await request(app)
      .post("/payments/p1/void")
      .set("Authorization", "Bearer good-token")
      .send({ reason: "cliente se fue sin pagar completo" });
    expect(res.status).toBe(202);
  });

  it("servidor CANNOT request a void", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const res = await request(app)
      .post("/payments/p1/void")
      .set("Authorization", "Bearer good-token")
      .send({ reason: "test" });
    expect(res.status).toBe(403);
    expect(requestVoid).not.toHaveBeenCalled();
  });

  it("cajero CANNOT authorize a void (BR-017: only admin/supervisor)", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
    const res = await request(app)
      .post("/payments/void-requests/vr1/authorize")
      .set("Authorization", "Bearer good-token")
      .send({ decision: "AUTHORIZED" });
    expect(res.status).toBe(403);
    expect(authorizeVoid).not.toHaveBeenCalled();
  });

  it("supervisor CAN authorize a void", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "supervisor" });
    vi.mocked(authorizeVoid).mockResolvedValue({
      id: "vr1",
      tenantId: "t1",
      paymentId: "p1",
      status: "EXECUTED",
      reason: "test",
      requestedByUserId: "u2",
      authorizedByUserId: "u1",
      requestedAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: "2026-01-01T00:01:00.000Z",
    });
    const res = await request(app)
      .post("/payments/void-requests/vr1/authorize")
      .set("Authorization", "Bearer good-token")
      .send({ decision: "AUTHORIZED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("EXECUTED");
  });
});
