# LOOP 08 — SEGURIDAD Y AUDITORÍA

Objetivo: endurecer el sistema.

Implementar/revisar:
- RLS;
- roles;
- permisos;
- políticas por restaurant_id;
- auditoría;
- acciones financieras privilegiadas;
- validaciones server-side;
- protección contra doble envío;
- idempotency keys.

Roles sugeridos para validar:
- admin;
- encargado;
- caja;
- servicio.

No autorizar por campos editables del perfil.

QA:
tests de acceso cruzado;
usuario sin permiso intentando anular;
usuario sin permiso intentando cerrar caja;
repetición de una operación financiera.
