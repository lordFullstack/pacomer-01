export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403);
  }
}

export class TableNotFoundError extends DomainError {
  constructor(tableId: string) {
    super(`Table ${tableId} not found for tenant`, "TABLE_NOT_FOUND", 404);
  }
}

export class TenantIsolationError extends DomainError {
  constructor() {
    super(
      "Cross-tenant access attempt blocked",
      "TENANT_ISOLATION_VIOLATION",
      403
    );
  }
}

export class ObligationNotFoundError extends DomainError {
  constructor(obligationId: string) {
    super(`Obligation ${obligationId} not found for tenant`, "OBLIGATION_NOT_FOUND", 404);
  }
}

export class ObligationAlreadySettledError extends DomainError {
  constructor(obligationId: string) {
    super(
      `Obligation ${obligationId} has no remaining balance (already PAID/SETTLED)`,
      "OBLIGATION_ALREADY_SETTLED",
      409
    );
  }
}

/**
 * BR-014: credit is never a tender method on /payments — it requires the
 * separate POST /credits endpoint owned by LOOP 09 (not yet implemented).
 */
export class CreditNotAllowedOnPaymentsError extends DomainError {
  constructor() {
    super(
      "Credit cannot be registered via /payments (BR-014). Use POST /credits (LOOP 09) once implemented.",
      "CREDIT_REQUIRES_SEPARATE_ENDPOINT",
      422
    );
  }
}

/**
 * Change can only be returned as cash. If tendered total exceeds the
 * obligations' remaining balance by more than the cash portion tendered,
 * the request is invalid — you cannot give "change" out of a transfer.
 */
export class ChangeExceedsCashTenderError extends DomainError {
  constructor() {
    super(
      "Change owed exceeds the cash portion tendered; change can only be returned in cash",
      "CHANGE_EXCEEDS_CASH_TENDER",
      422
    );
  }
}

export class CashSessionNotOpenError extends DomainError {
  constructor() {
    super("There is no OPEN/OPERATING cash session for this tenant", "CASH_SESSION_NOT_OPEN", 409);
  }
}

export class PaymentNotFoundError extends DomainError {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} not found for tenant`, "PAYMENT_NOT_FOUND", 404);
  }
}

export class PaymentAlreadyVoidedError extends DomainError {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} is already voided`, "PAYMENT_ALREADY_VOIDED", 409);
  }
}

/** BR-015: sensitive void always requires explicit OWNER_ADMIN authorization. */
export class VoidAuthorizationRequiredError extends DomainError {
  constructor() {
    super(
      "Void requires explicit OWNER_ADMIN authorization (BR-015) — request created, pending authorization",
      "VOID_AUTHORIZATION_REQUIRED",
      202
    );
  }
}

export class VoidRequestNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Void request ${id} not found for tenant`, "VOID_REQUEST_NOT_FOUND", 404);
  }
}

export class VoidRequestNotPendingError extends DomainError {
  constructor() {
    super("This void request has already been resolved", "VOID_REQUEST_NOT_PENDING", 409);
  }
}

/** BR-019: granting credit that would exceed the customer's configured limit. */
export class CreditLimitExceededError extends DomainError {
  constructor(customerId: string, limit: string, wouldBe: string) {
    super(
      `Granting this credit would push customer ${customerId}'s balance to ${wouldBe}, exceeding their limit of ${limit}`,
      "CREDIT_LIMIT_EXCEEDED",
      422
    );
  }
}

export class CustomerNotFoundError extends DomainError {
  constructor(customerId: string) {
    super(`Customer ${customerId} not found for tenant`, "CUSTOMER_NOT_FOUND", 404);
  }
}

export class NoOutstandingCreditError extends DomainError {
  constructor() {
    super("Customer has no outstanding credit balance to repay", "NO_OUTSTANDING_CREDIT", 409);
  }
}

export class SupplierNotFoundError extends DomainError {
  constructor(supplierId: string) {
    super(`Supplier ${supplierId} not found for tenant`, "SUPPLIER_NOT_FOUND", 404);
  }
}

/** BR-021: cuenta acumulada — a supplier payment can never exceed the running balance. */
export class SupplierPaymentExceedsBalanceError extends DomainError {
  constructor(balance: string, attempted: string) {
    super(
      `Payment of ${attempted} exceeds the supplier's outstanding balance of ${balance}`,
      "SUPPLIER_PAYMENT_EXCEEDS_BALANCE",
      422
    );
  }
}

export class NoOutstandingSupplierBalanceError extends DomainError {
  constructor() {
    super("Supplier has no outstanding balance to pay", "NO_OUTSTANDING_SUPPLIER_BALANCE", 409);
  }
}

/** A receipt can only be issued once some payment/credit has actually been registered. */
export class ObligationNotYetPaidError extends DomainError {
  constructor(obligationId: string) {
    super(
      `Obligation ${obligationId} has no payment or credit registered yet — cannot issue a receipt`,
      "OBLIGATION_NOT_YET_PAID",
      409
    );
  }
}
