import express from "express";
import cors from "cors";
import serviceLineRouter from "./api/routes/serviceLine";
import paymentsRouter from "./api/routes/payments";
import cashSessionsRouter from "./api/routes/cashSessions";
import creditsRouter from "./api/routes/credits";
import suppliersRouter from "./api/routes/suppliers";
import receiptsRouter from "./api/routes/receipts";
import reportsRouter from "./api/routes/reports";
import meRouter from "./api/routes/me";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { env } from "./config/env";

/**
 * App construction lives here, separate from server.ts's app.listen(),
 * specifically so tests/api/*.test.ts can `import app from "../../src/app"`
 * with supertest and exercise real routing/middleware/error-mapping without
 * ever binding a port or touching a live database.
 */
export const app = express();

// CORS: this API is called from a browser SPA on a different origin
// (Vercel) than the API itself (Render) — without this, every request
// fails at the browser's preflight check before it even reaches Express.
// See config/env.ts for why "*" is safe here (no cookie-based auth).
const allowedOrigins = env.allowedOrigins === "*" ? "*" : env.allowedOrigins.split(",").map((o) => o.trim());
app.use(cors({ origin: allowedOrigins }));

app.use(express.json());
app.use(requestLogger);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/service-line", serviceLineRouter);
app.use("/payments", paymentsRouter);
app.use("/cash-sessions", cashSessionsRouter);
app.use("/credits", creditsRouter);
app.use("/suppliers", suppliersRouter);
app.use("/receipts", receiptsRouter);
app.use("/reports", reportsRouter);
app.use("/me", meRouter);

// Fase 3 (LOOP 07→09→10→11→12) is now complete per the approved roadmap.

app.use(errorHandler);
