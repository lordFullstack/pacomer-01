import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/paymentService", () => ({ registerPayment: vi.fn() }));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import { registerPayment } from "../../src/services/paymentService";
import { ObligationAlreadySettledError } from "../../src/domain/errors";

describe("LOOP 18 — request correlation ID", () => {
  beforeEach(() => {
    clearMockUser();
    vi.mocked(registerPayment).mockReset();
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
  });

  it("every response carries a unique X-Request-Id header", async () => {
    vi.mocked(registerPayment).mockResolvedValue({
      paymentId: "p1",
      appliedAmount: "1.00",
      changeAmount: "0.00",
      allocations: [],
      eventId: "ev1",
    });
    const res1 = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send({ obligationIds: ["11111111-1111-1111-1111-111111111111"], tenders: [{ method: "efectivo", amount: "1.00" }], idempotencyKey: "k1-00000" });
    const res2 = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send({ obligationIds: ["11111111-1111-1111-1111-111111111111"], tenders: [{ method: "efectivo", amount: "1.00" }], idempotencyKey: "k2-00000" });

    expect(res1.headers["x-request-id"]).toBeTruthy();
    expect(res2.headers["x-request-id"]).toBeTruthy();
    expect(res1.headers["x-request-id"]).not.toBe(res2.headers["x-request-id"]);
  });

  it("error responses include the same requestId as the response header (support can correlate)", async () => {
    vi.mocked(registerPayment).mockRejectedValue(new ObligationAlreadySettledError("ob-1"));
    const res = await request(app)
      .post("/payments")
      .set("Authorization", "Bearer good-token")
      .send({ obligationIds: ["11111111-1111-1111-1111-111111111111"], tenders: [{ method: "efectivo", amount: "1.00" }], idempotencyKey: "k3-00000" });

    expect(res.status).toBe(409);
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });
});
