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
import tablesRouter from "./api/routes/tables";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { env } from "./config/env";

export const app = express();

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
app.use("/tables", tablesRouter);

app.use(errorHandler);