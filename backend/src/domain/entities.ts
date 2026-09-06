/**
 * LOOP 03 — Domain / Data Model (types mirror the approved entities).
 * This file only declares shapes used by LOOP 05 (Backend Core). Payment,
 * Tender, PaymentAllocation and Change belong to LOOP 08 and are NOT
 * implemented here — only referenced by id where needed.
 */

export type UUID = string;

export type PaymentMode = "individual" | "conjunto";

export type ObligationStatus =
  | "PENDING"
  | "PARTIAL"
  | "PAID"
  | "CREDIT"
  | "SETTLED";

export type TableSessionStatus = "OPEN" | "CLOSING" | "CLOSED";

export interface Tenant {
  id: UUID;
  restaurantId: UUID;
}

export interface TableSession {
  id: UUID;
  tenantId: UUID;
  tableId: UUID;
  status: TableSessionStatus;
  openedAt: string;
  closedAt: string | null;
}

export interface Diner {
  id: UUID;
  tenantId: UUID;
  tableSessionId: UUID;
  name: string | null;
  descriptor: string | null;
  createdAt: string;
  createdByUserId: UUID;
}

export interface Consumption {
  id: UUID;
  tenantId: UUID;
  dinerId: UUID;
  amount: string; // decimal as string — never use float for money
  createdAt: string;
}

export interface PaymentObligation {
  id: UUID;
  tenantId: UUID;
  dinerId: UUID;
  consumptionId: UUID;
  paymentMode: PaymentMode;
  amount: string; // decimal as string
  status: ObligationStatus;
  createdAt: string;
}

/**
 * LOOP 08 — Payments / Cash / Financial API
 *
 * BR-011: Payment.amount always represents APPLIED funds, never received.
 * BR-012: Tender = received funds; Change = returned funds. Change is a
 *   distinct entity/result, never modeled as an unassigned PaymentAllocation.
 * BR-013: financial records are never physically deleted — void is a status
 *   transition (ACTIVE -> VOIDED), always audited.
 * BR-014: credit is created via a separate POST /credits endpoint (LOOP 09),
 *   never as a tender method on /payments. This API rejects tender
 *   method "credito" explicitly.
 * BR-015: void requires a two-step request -> OWNER_ADMIN authorization flow.
 */

export type TenderMethod = "efectivo" | "transferencia";
export type PaymentStatus = "ACTIVE" | "VOIDED";

export interface Tender {
  id: UUID;
  paymentId: UUID;
  method: TenderMethod;
  amount: string; // decimal string — money received
}

export interface PaymentAllocation {
  id: UUID;
  paymentId: UUID;
  obligationId: UUID;
  amount: string; // decimal string — money applied to this obligation
}

export interface Change {
  id: UUID;
  paymentId: UUID;
  amount: string; // decimal string — money returned to the payer
}

export interface Payment {
  id: UUID;
  tenantId: UUID;
  status: PaymentStatus;
  amount: string; // BR-011: sum of PaymentAllocation, i.e. applied funds
  createdByUserId: UUID;
  createdAt: string;
  voidedAt: string | null;
  voidedByUserId: string | null;
}

export interface RegisterPaymentInput {
  obligationIds: UUID[]; // >1 means "conjunto": one payer covers several obligations
  tenders: Array<{ method: TenderMethod; amount: string }>;
  idempotencyKey: string;
}

export interface RegisterPaymentOutput {
  paymentId: UUID;
  appliedAmount: string;
  changeAmount: string;
  allocations: Array<{ obligationId: UUID; amount: string; obligationStatus: ObligationStatus }>;
  eventId: UUID;
}

export type CashSessionStatus = "OPEN" | "OPERATING" | "COUNTING" | "CLOSED";
export type CashMovementType = "SALE" | "ADJUSTMENT" | "REVERSAL" | "SUPPLIER_PAYMENT";

export interface CashSession {
  id: UUID;
  tenantId: UUID;
  status: CashSessionStatus;
  openedByUserId: UUID;
  openingCash: string;
  openedAt: string;
  closedAt: string | null;
  countedCash: string | null;
  expectedCash: string | null;
  difference: string | null;
}

export interface CashMovement {
  id: UUID;
  tenantId: UUID;
  cashSessionId: UUID;
  type: CashMovementType;
  amount: string; // signed decimal string: inflow positive, outflow negative
  paymentId: UUID | null;
  createdAt: string;
}

export type VoidRequestStatus =
  | "PENDING_AUTHORIZATION"
  | "AUTHORIZED"
  | "DENIED"
  | "EXECUTED"
  | "SELF_EXECUTED"; // BR-016: cajero voided their own payment within the self-void window

export interface PaymentVoidRequest {
  id: UUID;
  tenantId: UUID;
  paymentId: UUID;
  status: VoidRequestStatus;
  reason: string;
  requestedByUserId: UUID;
  authorizedByUserId: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

/**
 * LOOP 09 — Customer Credit.
 * BR-014: credit is created via POST /credits, never as a tender on /payments.
 * BR-018 (approved): any cajero may grant credit freely, no special authorization.
 * BR-019 (approved): each customer has a configurable credit_limit; granting
 *   credit that would push outstanding balance over the limit is rejected.
 * BR-020 (approved): no due date / mora tracking in this version — open
 *   balance only, repaid via abonos whenever the customer chooses.
 */

export type CustomerType = "persona" | "empresa";

export interface Customer {
  id: UUID;
  tenantId: UUID;
  name: string;
  phone: string;
  type: CustomerType;
  creditLimit: string; // decimal string
  createdAt: string;
}

export interface CustomerCredit {
  id: UUID;
  tenantId: UUID;
  customerId: UUID;
  obligationId: UUID;
  amount: string; // decimal string — the amount extended as credit
  createdByUserId: UUID;
  createdAt: string;
}

export interface RegisterCreditInput {
  obligationIds: UUID[];
  customer: { id: UUID } | { name: string; phone: string; type: CustomerType; creditLimit: string };
  idempotencyKey: string;
}

export interface RegisterCreditOutput {
  customerId: UUID;
  creditIds: UUID[];
  totalCredited: string;
  outstandingBalance: string;
  eventId: UUID;
}

export interface RegisterCreditRepaymentInput {
  customerId: UUID;
  tenders: Array<{ method: TenderMethod; amount: string }>;
  idempotencyKey: string;
}

export interface RegisterCreditRepaymentOutput {
  repaymentId: UUID;
  appliedAmount: string;
  changeAmount: string;
  outstandingBalance: string;
  allocations: Array<{ obligationId: UUID; amount: string; obligationStatus: ObligationStatus }>;
  eventId: UUID;
}

export interface CustomerAccountStatement {
  customer: Customer;
  outstandingBalance: string;
  credits: Array<{ id: UUID; obligationId: UUID; amount: string; createdAt: string }>;
  repayments: Array<{ id: UUID; appliedAmount: string; createdAt: string }>;
}

/**
 * LOOP 10 — Suppliers / Purchases.
 * BR-021 (approved): cuenta acumulada — purchases add to a single running
 *   balance per supplier, not one payable per invoice.
 * BR-022 (approved): no due dates / mora in this version, same as BR-020.
 * BR-023 (approved): taxes, goods-receipt tracking, and attachments are
 *   explicitly out of scope for this version (BR-010 already excludes
 *   inventory).
 */

export type SupplierPaymentTerms = "contado" | "semanal" | "quincenal";

export interface Supplier {
  id: UUID;
  tenantId: UUID;
  name: string;
  paymentTerms: SupplierPaymentTerms;
  createdAt: string;
}

export interface Purchase {
  id: UUID;
  tenantId: UUID;
  supplierId: UUID;
  amount: string;
  createdByUserId: UUID;
  createdAt: string;
}

export interface RegisterPurchaseInput {
  supplier: { id: UUID } | { name: string; paymentTerms: SupplierPaymentTerms };
  amount: string;
  idempotencyKey: string;
}

export interface RegisterPurchaseOutput {
  supplierId: UUID;
  purchaseId: UUID;
  outstandingBalance: string;
  eventId: UUID;
}

export interface RegisterSupplierPaymentInput {
  supplierId: UUID;
  tenders: Array<{ method: TenderMethod; amount: string }>;
  idempotencyKey: string;
}

export interface RegisterSupplierPaymentOutput {
  paymentId: UUID;
  appliedAmount: string;
  outstandingBalance: string;
  allocations: Array<{ purchaseId: UUID; amount: string }>;
  eventId: UUID;
}

export interface SupplierAccountStatement {
  supplier: Supplier;
  outstandingBalance: string;
  purchases: Array<{ id: UUID; amount: string; createdAt: string }>;
  payments: Array<{ id: UUID; appliedAmount: string; createdAt: string }>;
}

/**
 * LOOP 11 — Comprobantes (operational receipt only).
 * BR-024 (approved): no tax obligation currently exists for this business,
 *   so no fiscal/electronic-invoice integration is built. This is a plain
 *   operational receipt — 11_RECEIPTS_FISCAL.md's fiscal pendientes
 *   (jurisdiction, official numbering, tax types, credit notes) remain
 *   explicitly BLOCKED and untouched; sequentialNumber below is an internal
 *   operational counter only, never a fiscal consecutivo.
 */
export interface Receipt {
  id: UUID;
  tenantId: UUID;
  sequentialNumber: number;
  obligationIds: UUID[];
  amount: string;
  customerName: string | null;
  customerIdNumber: string | null; // "NIC o cédula" per 01_DISCOVERY.md, optional, non-fiscal
  issuedByUserId: UUID;
  issuedAt: string;
}

export interface IssueReceiptInput {
  obligationIds: UUID[];
  customerName?: string;
  customerIdNumber?: string;
  idempotencyKey: string;
}

export interface IssueReceiptOutput extends Receipt {
  eventId: UUID;
}

/**
 * LOOP 12 — Reports. Read-only shapes; "Próximos vencimientos" from the
 * MVP list is deliberately omitted — it depends on due dates, and BR-020/
 * BR-022 already decided neither customer credit nor supplier balances
 * carry a due date in this version. Not invented here.
 */
export interface DailySalesReport {
  date: string;
  totalApplied: string;
  paymentCount: number;
  byServer: Array<{ serverUserId: string; totalApplied: string }>;
  byMethod: Array<{ method: TenderMethod; totalTendered: string }>;
}

export interface PendingCollectionsReport {
  obligations: Array<{
    obligationId: UUID;
    tableId: UUID;
    tableLabel: string;
    dinerName: string | null;
    dinerDescriptor: string | null;
    amount: string;
    remaining: string;
    status: ObligationStatus;
  }>;
  totalRemaining: string;
}

export interface CustomerCreditsReport {
  customers: Array<{ customerId: UUID; name: string; outstandingBalance: string }>;
  totalOutstanding: string;
}

export interface CashStatusReport {
  sessionId: UUID | null;
  status: CashSessionStatus | "NO_SESSION";
  openingCash: string | null;
  expectedCash: string | null;
}

export interface PayablesReport {
  suppliers: Array<{ supplierId: UUID; name: string; outstandingBalance: string }>;
  totalPayable: string;
}

/**
 * Input contract for POST /service-line/diners
 * Mirrors 05_BACKEND.md "Endpoint conceptual prioritario".
 */
export interface RegisterDinerInput {
  tableId: UUID;
  amount: string; // decimal string, e.g. "12500.00"
  paymentMode: PaymentMode;
  name?: string;
  descriptor?: string;
  idempotencyKey: string;
}

export interface RegisterDinerOutput {
  dinerId: UUID;
  obligationId: UUID;
  tableSessionId: UUID;
  status: ObligationStatus;
  createdAt: string;
  eventId: UUID;
}
