import { PoolClient } from "pg";
import { withTransaction, pool } from "../db/pool";
import { claimIdempotencyKey, storeIdempotentResponse } from "../middleware/idempotency";
import { recordAuditEvent } from "../audit/auditLog";
import { toCents, fromCents } from "../domain/money";
import { allocateFifo } from "../domain/allocation";
import {
  RegisterCreditInput,
  RegisterCreditOutput,
  RegisterCreditRepaymentInput,
  RegisterCreditRepaymentOutput,
  CustomerAccountStatement,
  ObligationStatus,
} from "../domain/entities";
import {
  ValidationError,
  ObligationNotFoundError,
  ObligationAlreadySettledError,
  CreditLimitExceededError,
  CustomerNotFoundError,
  NoOutstandingCreditError,
  ChangeExceedsCashTenderError,
} from "../domain/errors";

async function resolveOrCreateCustomer(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  customer: RegisterCreditInput["customer"]
): Promise<{ id: string; creditLimitCents: number }> {
  if ("id" in customer) {
    const found = await client.query(
      `SELECT id, credit_limit FROM customers WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, customer.id]
    );
    if (found.rowCount === 0) throw new CustomerNotFoundError(customer.id);
    return { id: found.rows[0].id, creditLimitCents: toCents(found.rows[0].credit_limit) };
  }

  // New customer, identified going forward by (tenant, phone) — BR per
  // 09_CUSTOMER_CREDIT.md "Cliente identificado por nombre y celular".
  const existing = await client.query(
    `SELECT id, credit_limit FROM customers WHERE tenant_id = $1 AND phone = $2 FOR UPDATE`,
    [tenantId, customer.phone]
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return { id: existing.rows[0].id, creditLimitCents: toCents(existing.rows[0].credit_limit) };
  }

  if (toCents(customer.creditLimit) <= 0) {
    throw new ValidationError("creditLimit must be a positive decimal string");
  }

  const inserted = await client.query(
    `INSERT INTO customers (tenant_id, name, phone, type, credit_limit)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, credit_limit`,
    [tenantId, customer.name, customer.phone, customer.type, customer.creditLimit]
  );

  await recordAuditEvent(client, {
    tenantId,
    actorUserId,
    action: "CUSTOMER_CREATED",
    entityType: "customer",
    entityId: inserted.rows[0].id,
    metadata: { name: customer.name, phone: customer.phone, type: customer.type, creditLimit: customer.creditLimit },
  });

  return { id: inserted.rows[0].id, creditLimitCents: toCents(inserted.rows[0].credit_limit) };
}

async function outstandingBalanceCents(client: PoolClient, customerId: string): Promise<number> {
  const result = await client.query<{ balance: string }>(
    `SELECT
        coalesce((SELECT sum(amount * 100)::bigint FROM customer_credits WHERE customer_id = $1), 0)
        - coalesce((
            SELECT sum(cra.amount * 100)::bigint
            FROM credit_repayment_allocations cra
            JOIN credit_repayments cr ON cr.id = cra.repayment_id
            JOIN customer_credits cc ON cc.id = cra.customer_credit_id
            WHERE cc.customer_id = $1 AND cr.status = 'ACTIVE'
          ), 0) AS balance`,
    [customerId]
  );
  return Number(result.rows[0].balance);
}

/**
 * POST /credits — BR-014/BR-018/BR-019: any cajero may grant credit for one
 * or more obligations to a customer (new or existing), as long as it does
 * not push the customer's outstanding balance over their credit_limit.
 * Moves each obligation's remaining balance to CREDIT status.
 */
export async function registerCredit(
  actorUserId: string,
  tenantId: string,
  input: RegisterCreditInput
): Promise<RegisterCreditOutput> {
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (!input.obligationIds?.length) throw new ValidationError("obligationIds must have at least one id");

  const result = await withTransaction<RegisterCreditOutput | { duplicate: RegisterCreditOutput }>(async (client) => {
    const fingerprint = JSON.stringify({ obligationIds: [...input.obligationIds].sort(), customer: input.customer });
    const claim = await claimIdempotencyKey(client, tenantId, input.idempotencyKey, fingerprint);
    if (claim.isDuplicate) return { duplicate: claim.storedResponse as RegisterCreditOutput };

    const { id: customerId, creditLimitCents } = await resolveOrCreateCustomer(
      client,
      tenantId,
      actorUserId,
      input.customer
    );

    const obligations = await client.query(
      `SELECT
          po.id, po.amount, po.status,
          (po.amount * 100)::bigint
            - coalesce((
                SELECT sum(pa.amount * 100)::bigint
                FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
                WHERE pa.obligation_id = po.id AND p.status = 'ACTIVE'
              ), 0)
            - coalesce((SELECT sum(cc.amount * 100)::bigint FROM customer_credits cc WHERE cc.obligation_id = po.id), 0)
            AS remaining_cents
       FROM payment_obligations po
       WHERE po.tenant_id = $1 AND po.id = ANY($2::uuid[])
       FOR UPDATE`,
      [tenantId, input.obligationIds]
    );
    if (obligations.rowCount !== input.obligationIds.length) {
      const found = new Set(obligations.rows.map((r) => r.id));
      throw new ObligationNotFoundError(input.obligationIds.find((id) => !found.has(id)) ?? "unknown");
    }

    const currentBalance = await outstandingBalanceCents(client, customerId);
    const toCreditCents = obligations.rows.reduce((sum, o) => {
      const remaining = Number(o.remaining_cents);
      if (remaining <= 0) throw new ObligationAlreadySettledError(o.id);
      return sum + remaining;
    }, 0);

    if (currentBalance + toCreditCents > creditLimitCents) {
      throw new CreditLimitExceededError(
        customerId,
        fromCents(creditLimitCents),
        fromCents(currentBalance + toCreditCents)
      );
    }

    const creditIds: string[] = [];
    for (const o of obligations.rows) {
      const amountCents = Number(o.remaining_cents);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO customer_credits (tenant_id, customer_id, obligation_id, amount, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [tenantId, customerId, o.id, fromCents(amountCents), actorUserId]
      );
      creditIds.push(inserted.rows[0].id);
      await client.query(`UPDATE payment_obligations SET status = 'CREDIT' WHERE id = $1`, [o.id]);
    }

    const eventId = await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "CREDIT_GRANTED",
      entityType: "customer",
      entityId: customerId,
      metadata: { obligationIds: input.obligationIds, totalCredited: fromCents(toCreditCents) },
    });

    const output: RegisterCreditOutput = {
      customerId,
      creditIds,
      totalCredited: fromCents(toCreditCents),
      outstandingBalance: fromCents(currentBalance + toCreditCents),
      eventId,
    };
    await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
    return output;
  });

  return "duplicate" in result ? result.duplicate : result;
}

/**
 * POST /credits/:customerId/repayments — abono. Allocates the tendered
 * amount across the customer's outstanding customer_credits oldest-first,
 * mirroring the allocation strategy already approved for /payments.
 * Updates each affected obligation: CREDIT -> PARTIAL -> SETTLED.
 */
export async function registerCreditRepayment(
  actorUserId: string,
  tenantId: string,
  input: RegisterCreditRepaymentInput
): Promise<RegisterCreditRepaymentOutput> {
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (!input.tenders?.length) throw new ValidationError("tenders must have at least one entry");

  const result = await withTransaction<
    RegisterCreditRepaymentOutput | { duplicate: RegisterCreditRepaymentOutput }
  >(async (client) => {
    const fingerprint = JSON.stringify({ customerId: input.customerId, tenders: input.tenders });
    const claim = await claimIdempotencyKey(client, tenantId, input.idempotencyKey, fingerprint);
    if (claim.isDuplicate) return { duplicate: claim.storedResponse as RegisterCreditRepaymentOutput };

    const customer = await client.query(
      `SELECT id, credit_limit FROM customers WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, input.customerId]
    );
    if (customer.rowCount === 0) throw new CustomerNotFoundError(input.customerId);

    const outstandingCredits = await client.query<{
      id: string;
      obligation_id: string;
      amount: string;
      remaining_cents: string;
    }>(
      `SELECT
          cc.id, cc.obligation_id, cc.amount,
          (cc.amount * 100)::bigint
            - coalesce((
                SELECT sum(cra.amount * 100)::bigint
                FROM credit_repayment_allocations cra
                JOIN credit_repayments cr ON cr.id = cra.repayment_id
                WHERE cra.customer_credit_id = cc.id AND cr.status = 'ACTIVE'
              ), 0) AS remaining_cents
       FROM customer_credits cc
       WHERE cc.customer_id = $1
       ORDER BY cc.created_at ASC
       FOR UPDATE`,
      [input.customerId]
    );

    const withBalance = outstandingCredits.rows
      .map((r) => ({ ...r, remaining_cents: Number(r.remaining_cents) }))
      .filter((r) => r.remaining_cents > 0);

    if (withBalance.length === 0) throw new NoOutstandingCreditError();

    const tenderTotalCents = input.tenders.reduce((s, t) => s + toCents(t.amount), 0);
    const cashTenderCents = input.tenders
      .filter((t) => t.method === "efectivo")
      .reduce((s, t) => s + toCents(t.amount), 0);

    const { allocations: fifoLines, appliedTotalCents: appliedCents, leftoverCents: changeCents } = allocateFifo(
      withBalance.map((cc) => ({ id: cc.id, remainingCents: cc.remaining_cents })),
      tenderTotalCents
    );
    const obligationByCredit = new Map(withBalance.map((cc) => [cc.id, cc.obligation_id]));
    const allocations = fifoLines.map((line) => ({
      customerCreditId: line.id,
      obligationId: obligationByCredit.get(line.id)!,
      cents: line.appliedCents,
      newStatus: (line.remainingAfterCents === 0 ? "SETTLED" : "PARTIAL") as ObligationStatus,
    }));
    if (changeCents > cashTenderCents) throw new ChangeExceedsCashTenderError();

    const repayment = await client.query<{ id: string }>(
      `INSERT INTO credit_repayments (tenant_id, customer_id, status, applied_amount, created_by_user_id)
       VALUES ($1, $2, 'ACTIVE', $3, $4)
       RETURNING id`,
      [tenantId, input.customerId, fromCents(appliedCents), actorUserId]
    );
    const repaymentId = repayment.rows[0].id;

    for (const t of input.tenders) {
      await client.query(
        `INSERT INTO credit_repayment_tenders (repayment_id, method, amount) VALUES ($1, $2, $3)`,
        [repaymentId, t.method, t.amount]
      );
    }

    const allocationOutputs: RegisterCreditRepaymentOutput["allocations"] = [];
    for (const a of allocations) {
      await client.query(
        `INSERT INTO credit_repayment_allocations (repayment_id, customer_credit_id, amount) VALUES ($1, $2, $3)`,
        [repaymentId, a.customerCreditId, fromCents(a.cents)]
      );
      await client.query(`UPDATE payment_obligations SET status = $1 WHERE id = $2`, [a.newStatus, a.obligationId]);
      allocationOutputs.push({ obligationId: a.obligationId, amount: fromCents(a.cents), obligationStatus: a.newStatus });
    }

    if (changeCents > 0) {
      await client.query(`INSERT INTO credit_repayment_change (repayment_id, amount) VALUES ($1, $2)`, [
        repaymentId,
        fromCents(changeCents),
      ]);
    }

    const newBalance = await outstandingBalanceCents(client, input.customerId);

    const eventId = await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "CREDIT_REPAYMENT_REGISTERED",
      entityType: "customer",
      entityId: input.customerId,
      metadata: { appliedAmount: fromCents(appliedCents), changeAmount: fromCents(changeCents) },
    });

    const output: RegisterCreditRepaymentOutput = {
      repaymentId,
      appliedAmount: fromCents(appliedCents),
      changeAmount: fromCents(changeCents),
      outstandingBalance: fromCents(newBalance),
      allocations: allocationOutputs,
      eventId,
    };
    await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
    return output;
  });

  return "duplicate" in result ? result.duplicate : result;
}

/**
 * Simple read model for "estado de cuenta / historial" (09_CUSTOMER_CREDIT.md
 * requirement). Read-only, outside any write transaction.
 */
export async function getCustomerAccountStatement(
  tenantId: string,
  customerId: string
): Promise<CustomerAccountStatement> {
  const customer = await pool.query(
    `SELECT id, tenant_id, name, phone, type, credit_limit, created_at
     FROM customers WHERE tenant_id = $1 AND id = $2`,
    [tenantId, customerId]
  );
  if (customer.rowCount === 0) throw new CustomerNotFoundError(customerId);

  const credits = await pool.query(
    `SELECT id, obligation_id, amount, created_at FROM customer_credits
     WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
    [tenantId, customerId]
  );
  const repayments = await pool.query(
    `SELECT id, applied_amount, created_at FROM credit_repayments
     WHERE tenant_id = $1 AND customer_id = $2 AND status = 'ACTIVE' ORDER BY created_at DESC`,
    [tenantId, customerId]
  );
  const balanceCents = await outstandingBalanceCents(pool as unknown as PoolClient, customerId);

  const row = customer.rows[0];
  return {
    customer: {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      phone: row.phone,
      type: row.type,
      creditLimit: row.credit_limit,
      createdAt: row.created_at,
    },
    outstandingBalance: fromCents(balanceCents),
    credits: credits.rows.map((r) => ({ id: r.id, obligationId: r.obligation_id, amount: r.amount, createdAt: r.created_at })),
    repayments: repayments.rows.map((r) => ({ id: r.id, appliedAmount: r.applied_amount, createdAt: r.created_at })),
  };
}
