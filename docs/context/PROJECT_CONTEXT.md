# PROJECT CONTEXT — FAST TRACK by PA' COMER

## Producto
PWA para operación interna de restaurante.

## Objetivo
Centralizar mesas, cobros, clientes, proveedores, caja, reportes y logs con una interfaz minimalista, limpia y extremadamente ágil.

## Módulos
1. Registro / acceso
2. Mesas
3. Clientes
4. Proveedores
5. Reportes
6. Caja
7. Logs / auditoría
8. Configuración mínima

## Mesas
La vista inicial muestra 15 tarjetas de mesas.
Cada tarjeta muestra:
- número;
- estado;
- total acumulado;
- cantidad de comensales;
- nombre(s) cuando exista(n).

Al tocar una mesa se abre un modal/drawer operativo.

Acciones de mesa:
- agregar comensal;
- registrar/editar consumo;
- cobrar individual;
- cobrar mesa;
- fiar;
- modificar;
- cerrar mesa;
- anular movimiento (con permisos);
- ver historial.

## Proveedores
Vista de dos paneles:
- lista de proveedores a la derecha;
- detalle desplegable/seleccionado.

Cada proveedor:
- datos básicos;
- pedidos;
- créditos/deudas;
- vencimientos;
- pagos;
- log de movimientos.

Los pedidos deben guardar fecha y modalidad de pago:
- contado;
- semanal;
- quincenal;
- crédito/otra condición configurable.

## Clientes
Debe existir ficha de cliente y lógica de:
- consumos;
- créditos/fiados;
- abonos;
- saldo;
- historial;
- log de movimientos;
- búsqueda rápida.

## Reportes
KPIs mínimos:
- venta total;
- ticket promedio;
- número de tickets;
- ventas por mesa;
- ventas por rango de fecha;
- anulaciones;
- fiado y recuperación.

Log agrupado por día y con:
- fecha;
- hora y minuto;
- mesa;
- importe;
- operación;
- usuario;
- estado.

Ejemplo visual:
`45.000 · Mesa 1 · 08:42`

La anulación nunca debe borrar físicamente el movimiento: debe crear una operación de reversión/auditoría.

## Caja
- apertura;
- fondo inicial;
- ingresos;
- egresos;
- ventas;
- fiados;
- abonos;
- cuadre manual;
- cierre;
- cuadre automático a las 00:00.

El cierre automático debe ser idempotente y auditable.

## UX
Mobile-first.
También debe funcionar muy bien en tablet/desktop.
Prioridad:
1. velocidad;
2. legibilidad;
3. prevención de errores;
4. trazabilidad.

## Firma
Toda interfaz principal debe incluir de forma discreta:
**JGC.LABS**
y cuando corresponda:
**FAST TRACK by PA' COMER**
