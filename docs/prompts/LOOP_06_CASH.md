# LOOP 06 — CAJA

Objetivo: caja operacional segura.

Implementar:
- apertura;
- fondo inicial;
- movimientos;
- ventas vinculadas;
- abonos;
- egresos;
- cuadre manual;
- cierre;
- cierre automático 00:00;
- historial.

Reglas:
- una caja activa por restaurante;
- cierre idempotente;
- diferencia visible;
- operaciones financieras atómicas;
- auditoría.

El cierre automático debe tener estrategia server-side/cron compatible con Supabase y ser verificable.

QA:
apertura;
venta;
abono;
egreso;
cuadre;
diferencia;
cierre;
reintento de cierre automático.
