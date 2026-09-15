# UX SPEC

## Estética
Minimalista, limpia, profesional.
Evitar dashboards saturados.

## Inicio / Registro
El acceso debe ser rápido.
- input enfocado automáticamente;
- Enter avanza/ejecuta;
- mensajes de error inline;
- teclado numérico cuando aplique;
- evitar formularios largos.

## Mesas
Grid responsive de cards.

Estados sugeridos:
- libre;
- ocupada;
- pendiente de cobro;
- fiada/parcial;
- bloqueada.

La tarjeta debe mostrar visualmente el estado sin depender solo del color.

Tap → modal/drawer.

## Modal de mesa
Header:
Mesa # + estado + total.

Contenido:
- comensales;
- consumos;
- subtotal/total;
- acciones rápidas.

Acciones principales:
`Agregar` · `Cobrar` · `Fiado` · `Modificar`

Acciones secundarias:
`Historial` · `Cerrar` · `Anular`

## Proveedores
Desktop/tablet:
lista lateral derecha + detalle.
Mobile:
lista → detalle como drawer/page.

## Clientes
Búsqueda primero.
Ficha compacta con saldo y movimientos recientes.
Abono como CTA visible cuando exista saldo.

## Reportes
Primero KPIs, luego filtros, luego timeline/log.
Los logs deben ser escaneables.

## Caja
Mostrar estado actual arriba:
`ABIERTA · Fondo $X · Ventas $Y · Efectivo esperado $Z`

Cuadre manual con diferencia explícita:
`Esperado / Contado / Diferencia`

## Accesibilidad
- foco visible;
- targets táctiles adecuados;
- labels reales;
- contraste suficiente;
- soporte reduced motion;
- navegación por teclado en desktop.

## JGC.LABS
Firma discreta en shell/footer:
`JGC.LABS`
