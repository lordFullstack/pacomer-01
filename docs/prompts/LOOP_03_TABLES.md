# LOOP 03 — MESAS

Objetivo: operación de salón en una pantalla.

Implementar:
- 15 cards iniciales;
- arquitectura para agregar mesas;
- estados;
- total;
- comensales;
- modal/drawer;
- agregar comensal;
- modificar;
- cobrar individual;
- cobrar mesa;
- fiar;
- cerrar.

La card debe ser el centro operativo.

Cobro individual:
- por comensal;
- por ítems;
- por importe cuando sea necesario.

Fiado:
- requiere cliente.

No borrar tickets.

QA medible:
- abrir mesa ≤ 1 interacción;
- agregar comensal sin salir de mesa;
- cobrar individual conserva saldo restante;
- fiado crea movimiento de cliente;
- cerrar mesa libera la card.
