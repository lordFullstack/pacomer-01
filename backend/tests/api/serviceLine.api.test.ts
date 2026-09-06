import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/dinerService", () => ({
  registerDiner: vi.fn(),
}));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import { registerDiner } from "../../src/services/dinerService";

const VALID_BODY = {
  tableId: "11111111-1111-1111-1111-111111111111",
  amount: "12000.00",
  paymentMode: "individual",
  idempotencyKey: "test-key-00000001",
};

describe("POST /service-line/diners — API wiring", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerDiner).mockReset();
  });

  it("rejects with 401 when no bearer token is provided", async () => {
    const res = await request(app).post("/service-line/diners").send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(registerDiner).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the token doesn't resolve to a known user", async () => {
    const res = await request(app)
      .post("/service-line/diners")
      .set("Authorization", "Bearer garbage-token")
      .send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("rejects with 403 when the caller's role is not servidor/admin (e.g. cajero)", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
    const res = await request(app)
      .post("/service-line/diners")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(registerDiner).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the body fails zod validation (missing idempotencyKey)", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const { idempotencyKey: _drop, ...bad } = VALID_BODY;
    const res = await request(app)
      .post("/service-line/diners")
      .set("Authorization", "Bearer good-token")
      .send(bad);
    expect(res.status).toBe(400);
    expect(registerDiner).not.toHaveBeenCalled();
  });

  it("rejects with 400 when amount isn't a valid decimal string", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const res = await request(app)
      .post("/service-line/diners")
      .set("Authorization", "Bearer good-token")
      .send({ ...VALID_BODY, amount: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("calls registerDiner with the authenticated actor/tenant and returns 201 with its output", async () => {
    setMockUser({ authUserId: "u1", tenantId: "tenant-abc", role: "servidor" });
    vi.mocked(registerDiner).mockResolvedValue({
      dinerId: "d1",
      obligationId: "ob1",
      tableSessionId: "ts1",
      status: "PENDING",
      createdAt: "2026-01-01T00:00:00.000Z",
      eventId: "ev1",
    });

    const res = await request(app)
      .post("/service-line/diners")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.dinerId).toBe("d1");
    // Note: registerDiner's first arg is req.user!.id, which auth.ts sets
    // from app_users.id (not the Supabase auth_user_id) — here the mock
    // returns tenant-abc as tenant_id directly, confirming the middleware
    // wires tenantId through correctly to the service call.
    expect(registerDiner).toHaveBeenCalledWith(
      expect.any(String),
      "tenant-abc",
      expect.objectContaining({ tableId: VALID_BODY.tableId, amount: VALID_BODY.amount })
    );
  });

  it("allows role 'admin' too (owner acting as servidor is not blocked)", async () => {
    setMockUser({ authUserId: "u2", tenantId: "t1", role: "admin" });
    vi.mocked(registerDiner).mockResolvedValue({
      dinerId: "d2",
      obligationId: "ob2",
      tableSessionId: "ts2",
      status: "PENDING",
      createdAt: "2026-01-01T00:00:00.000Z",
      eventId: "ev2",
    });
    const res = await request(app)
      .post("/service-line/diners")
      .set("Authorization", "Bearer good-token")
      .send(VALID_BODY);
    expect(res.status).toBe(201);
  });
});
