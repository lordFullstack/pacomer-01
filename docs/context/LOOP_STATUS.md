# LOOP STATUS — auditoría inicial (2026-09-15)

Mapeo del estado real de `pacomer-01` contra `docs/qa/ACCEPTANCE_CRITERIA.md`
y los loops 00–12 de este paquete. Ver también D-001 en `DECISIONS.md`: se
audita sobre el stack existente (Vite+React+Express+PostgreSQL+Supabase),
no sobre Next.js.

Convención: ✅ hecho · 🟡 parcial · ⬜ pendiente.

## LOOP 00/01 — Fundación
✅ App shell, navegación por rol (servidor/cajero/admin), identidad FAST TRACK.
🟡 No es PWA (sin manifest, sin instalabilidad, sin service worker).

## LOOP 02 — Auth y registro ágil
✅ Login real contra Supabase Auth (`loginWithPassword` + `/me`).
⬜ **Sesión no persiste**: `App.tsx` guarda la sesión solo en `useState`;
   un refresh cierra la sesión. Contradice el criterio de aceptación
   "sesión persiste correctamente". → Corregido en esta misma sesión
   (ver `frontend/src/lib/sessionStorage.ts`).
🟡 Sin manejo explícito de "sesión expirada" con mensaje dedicado.

## LOOP 03 — Mesas
🟡 `ServerScreen` registra comensales/consumos por mesa (rápido, ≤3s), pero
   no es la "tarjeta de mesa" con estado/total/comensales + modal operativo
   completo que describe `UX_SPEC.md`. La operación de cobro/fiado vive en
   `CashierScreen`, no en una card de mesa.
✅ Cobro individual (`cobrarObligation`), cobrar mesa completa (`cobrarTodo`),
   fiar con cliente (`fiarObligation`), liberar sin cobrar, cerrar.
⬜ No hay vista de 15 cards con estado visual (libre/ocupada/pendiente/fiada).

## LOOP 04 — Clientes
✅ `ClientsScreen` (admin) + `creditService`/`dinerService` en backend.
🟡 Falta verificar en código: búsqueda rápida, ficha con historial completo.

## LOOP 05 — Proveedores
✅ `ProvidersScreen` (admin) + `supplierService` + migración
   `0005_loop10_suppliers_purchases.sql`.
🟡 Falta verificar layout de dos paneles (lista + detalle) en desktop.

## LOOP 06 — Caja
✅ Apertura/cierre, cuadre, `cashSessionService`, migración `0002_loop08_payments_cash.sql`.
⬜ Cierre automático a las 00:00 no confirmado (sin evidencia de cron/edge
   function); revisar antes de darlo por hecho.

## LOOP 07 — Reportes
✅ `ReportsScreen` (admin) — incluye el log de anulaciones (única vía de
   anular un cobro, según comentario en `AdminScreen.tsx`).
🟡 Falta verificar KPIs exactos (ticket promedio, ventas por mesa) contra
   `ACCEPTANCE_CRITERIA.md`.

## LOOP 08 — Seguridad y auditoría
✅ `requireRole` middleware, `auditLog.ts`, idempotencia
   (`idempotency.ts`, `genIdempotencyKey`), migración
   `0003_loop13_security_roles.sql`.
🟡 No confirmado si RLS está habilitado en Supabase además de la
   autorización en Express (el modelo actual autoriza en el backend
   Express, lo cual ya cumple "no autorizar solo en frontend").

## LOOP 09 — PWA y resiliencia
⬜ No implementado: sin manifest, sin offline shell, sin cola local.

## LOOP 10 — Velocidad operativa
✅ `ServerScreen` ya está diseñado explícitamente para "registro en ≤3s".
🟡 Hay exploraciones de rediseño de la vista cajero en curso
   (`design-cajero/*.dc.html`, sin commitear) — no tocar sin alinear con
   el usuario, parece trabajo de diseño en progreso de otra sesión.

## LOOP 11 — QA y release
🟡 Tests existentes: `backend/tests/{unit,api,integration}` (money,
   allocation, serviceLine, payments, credits, receipts, suppliers,
   reports, observability). Sin evidencia de Playwright en frontend.

## LOOP 12 — Handoff final
⬜ No existe `FINAL_HANDOFF.md` todavía.

## Pendiente de validar con Jorge
Las 9 decisiones de negocio de `DECISIONS.md` (roles exactos, descuentos,
domicilios, propinas, impuestos/facturación, métodos de pago, reglas de
modificar tickets cobrados, condiciones de crédito de proveedor, retención
de logs) siguen sin confirmar — no se han inventado por esta sesión.
