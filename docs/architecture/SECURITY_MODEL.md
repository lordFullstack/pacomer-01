# SECURITY MODEL

## Principio
El frontend no es una frontera de seguridad.

## Roles
Modelo inicial:
- admin
- encargado
- caja
- servicio

Debe validarse con Jorge antes de congelar.

## Acciones sensibles
- anular venta;
- modificar ticket cerrado;
- cerrar caja;
- registrar egreso;
- modificar crédito;
- ajustar saldo.

Cada una requiere permiso explícito y log.

## RLS
Aislar por restaurant_id.
Toda tabla expuesta debe tener RLS.

## Auditoría
Guardar:
- actor;
- acción;
- entidad;
- entidad_id;
- timestamp;
- metadata;
- referencia cuando exista.

## Anulación
No DELETE.
Crear reversal/anulación y relacionarla con el original.
