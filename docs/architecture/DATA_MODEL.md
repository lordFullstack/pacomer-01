# DATA MODEL RULES

1. Todos los importes monetarios deben usar numeric/decimal, nunca float.
2. Todas las entidades operativas deben pertenecer a un restaurant_id.
3. No borrar físicamente movimientos financieros.
4. Todo movimiento relevante debe poder rastrearse a actor + timestamp + referencia.
5. Estados deben ser explícitos y validados.
6. Foreign keys para relaciones críticas.
7. Timestamps en UTC en base de datos; UI en zona horaria del restaurante.
8. Idempotency keys para operaciones que puedan reintentarse.
9. RLS en tablas expuestas.
10. Las decisiones de autorización no deben depender de user_metadata editable.

El esquema exacto debe generarse mediante migraciones versionadas.
