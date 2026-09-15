# ARCHITECTURE

## Capas

### UI
- App shell
- navegación
- cards
- modals/drawers
- tablas/listas
- formularios
- toasts
- confirmaciones

### Domain
Servicios y reglas:
- tableService
- ticketService
- paymentService
- customerService
- supplierService
- cashService
- reportService
- auditService

### Data
Supabase client/server.
Nunca exponer service role en navegador.

### Seguridad
RLS + roles + validaciones server-side.

## Entidades principales

### restaurants
id, name, status, created_at

### profiles
id, restaurant_id, full_name, role, active

### tables
id, restaurant_id, number, name, capacity, active, created_at

### table_sessions
id, table_id, opened_at, closed_at, status, guest_count, opened_by

### customers
id, restaurant_id, name, phone, notes, active, created_at

### customer_accounts
id, customer_id, balance, credit_limit, status

### customer_transactions
id, customer_id, type, amount, reference_id, created_at, created_by

### suppliers
id, restaurant_id, name, phone, notes, active

### supplier_orders
id, supplier_id, order_date, due_date, payment_terms, total, status

### supplier_transactions
id, supplier_id, type, amount, reference_id, created_at, created_by

### products
id, restaurant_id, name, price, category_id, active

### tickets
id, restaurant_id, table_session_id, customer_id, subtotal, discount, total, status, opened_at, closed_at

### ticket_items
id, ticket_id, product_id, description, quantity, unit_price, guest_id, status

### guests
id, table_session_id, display_name, created_at

### payments
id, ticket_id, customer_id, method, amount, paid_at, status

### cash_registers
id, restaurant_id, opened_at, opening_amount, closed_at, closing_amount, status

### cash_movements
id, cash_register_id, type, amount, reference_id, description, created_at, created_by

### audit_logs
id, restaurant_id, actor_id, entity_type, entity_id, action, metadata, created_at

## Índices
Priorizar índices por:
- restaurant_id
- table_id
- table_session_id
- customer_id
- supplier_id
- created_at
- status
- due_date

## Realtime
Usar Realtime donde aporte valor:
- estado de mesas;
- caja;
- movimientos críticos.
No usar realtime indiscriminadamente.

## Transacciones
Operaciones como cobrar, abonar, cerrar caja y anular deben ser atómicas.
Preferir funciones RPC/operaciones server-side para invariantes financieros.

## Offline
La PWA debe contemplar UX resiliente ante pérdida breve de red.
No inventar una contabilidad offline compleja en LOOP 1.
Primero establecer modelo online consistente y después implementar cola offline para operaciones aprobadas.
