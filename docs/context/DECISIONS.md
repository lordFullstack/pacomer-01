# DECISIONS

## D-001 — Arquitectura
Next.js + TypeScript + Tailwind + PWA + Supabase.

**SUPERSEDIDA (2026-09-15):** al recibir este paquete de loops, `pacomer-01` ya
era un sistema real en marcha (frontend Vite+React 18, backend Express +
PostgreSQL + Supabase Auth, desplegado en `pacomer-01.onrender.com`, con
6 migraciones, servicios de dominio para pagos/caja/crédito/proveedores/
recibos/anulaciones y tests unit+api+integration). El usuario decidió
**continuar sobre esa base real** en vez de reconstruir en Next.js. Los 12
loops de este paquete se usan como checklist/proceso de auditoría y cierre
de brechas sobre el stack existente (Vite + React + Express + PostgreSQL +
Supabase), no como instrucción de migración de stack. Ver
`docs/context/LOOP_STATUS.md` para el mapeo de estado por módulo.

## D-002 — Mesas
15 mesas visibles inicialmente, pero la arquitectura debe permitir agregar más sin cambiar el modelo de datos.

## D-003 — Cobro individual
Un ticket puede contener varios comensales y permitir dividir el cobro por persona, productos/ítems o importe.

## D-004 — Fiado
El fiado solo puede asociarse a un cliente identificado. Si no existe cliente, la UI debe ofrecer crear/seleccionar uno antes de confirmar.

## D-005 — Anulaciones
No eliminar transacciones históricas. Usar reversión/anulación con motivo, usuario, timestamp y referencia al movimiento original.

## D-006 — Caja automática
El cierre automático de 00:00 debe ejecutarse una sola vez por fecha/caja y dejar log.

## D-007 — Seguridad
Roles y permisos deben resolverse en backend/RLS, no únicamente ocultando botones en frontend.

## DECISIONES A VALIDAR CON JORGE
- Roles exactos del personal.
- Si existirán descuentos.
- Si se manejarán domicilios.
- Si se manejarán propinas.
- Impuestos/facturación electrónica, si aplica.
- Métodos de pago exactos.
- Reglas para modificar tickets ya cobrados.
- Si el proveedor puede tener múltiples condiciones de crédito.
- Retención de logs y permisos para anulación.
