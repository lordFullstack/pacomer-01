import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
vi.mock("../../src/services/reportService", () => ({
  getDailySalesReport: vi.fn(),
  getPendingCollectionsReport: vi.fn(),
  getCustomerCreditsReport: vi.fn(),
  getCashStatusReport: vi.fn(),
  getPayablesReport: vi.fn(),
}));

import { app } from "../../src/app";
import { setMockUser, clearMockUser } from "./mockSupabaseClient";
import {
  getDailySalesReport,
  getPendingCollectionsReport,
  getCustomerCreditsReport,
  getCashStatusReport,
  getPayablesReport,
} from "../../src/services/reportService";

const endpoints = [
  { path: "/reports/daily-sales", mockFn: getDailySalesReport },
  { path: "/reports/pending-collections", mockFn: getPendingCollectionsReport },
  { path: "/reports/customer-credits", mockFn: getCustomerCreditsReport },
  { path: "/reports/cash-status", mockFn: getCashStatusReport },
  { path: "/reports/payables", mockFn: getPayablesReport },
];

describe("GET /reports/* — read-only, no critical-path impact", () => {
  beforeEach(() => {
    clearMockUser();
    for (const e of endpoints) vi.mocked(e.mockFn).mockReset();
  });

  it.each(endpoints)("$path: servidor is blocked (403) — dashboard is not a servidor concern", async ({ path }) => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "servidor" });
    const res = await request(app).get(path).set("Authorization", "Bearer good-token");
    expect(res.status).toBe(403);
  });

  it.each(endpoints)("$path: cajero can view it (200) and it calls through to the service", async ({ path, mockFn }) => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "cajero" });
    vi.mocked(mockFn).mockResolvedValue({} as never);
    const res = await request(app).get(path).set("Authorization", "Bearer good-token");
    expect(res.status).toBe(200);
    expect(mockFn).toHaveBeenCalled();
    expect(mockFn.mock.calls[0][0]).toBe("t1");
  });

  it("daily-sales forwards an explicit ?date= query param to the service", async () => {
    setMockUser({ authUserId: "u1", tenantId: "t1", role: "admin" });
    vi.mocked(getDailySalesReport).mockResolvedValue({} as never);
    await request(app).get("/reports/daily-sales?date=2026-01-15").set("Authorization", "Bearer good-token");
    expect(getDailySalesReport).toHaveBeenCalledWith("t1", "2026-01-15");
  });
});
