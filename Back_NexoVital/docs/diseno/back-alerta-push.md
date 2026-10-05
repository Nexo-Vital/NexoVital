# Alerta de escasez en vivo — push post-commit a `/topic/alerts`

**Historia:** Azure 225 / EP-03.F1.US5 (extiende la alerta persistida).
**Rama:** `back-alerta-push` (backend) y `front-alerta-push` (front).

## El hueco

Un despacho rechazado por stock insuficiente
(`POST /api/v1/centros-acopio/{id}/inventario/despacho` → `409 STOCK_INSUFICIENTE`)
**persiste** la alerta de escasez en su propia transacción (`REQUIRES_NEW`,
FA-6 de `back-225-alerta-escasez.md`), pero **no publicaba ningún evento**. El
front solo vuelve a leer `GET /api/v1/mapa` —de donde sale la proyección de
alerta— cuando recibe un frame de `/topic/suministros`, y un rechazo **no mueve
inventario** (el CAS revierte). Un `409` sin movimiento posterior de stock se
reflejaba recién en la siguiente lectura.

## Decisión: canal dedicado `/topic/alerts`

El evento se publica **después del commit de la transacción de la alerta**.
`RegistrarAlertaEscasezUseCaseImpl` publica `AlertaEscasezRegistradaEvento`
dentro de su transacción `REQUIRES_NEW`; el listener
`AlertaEscasezPushListener` usa `@TransactionalEventListener(AFTER_COMMIT)`,
de modo que Spring registra la sincronización **sobre esa** transacción y el
frame sale cuando la alerta commitea — nunca en el rollback del despacho.

El nombre **no se inventa**: el diseño del sistema ya declara `/topic/alerts`
como destino del gateway
(`system-design/10-organizacion-modular-hexagonal.md:147-148`,
`system-design/09-organizacion-microservicios-corregida.md:272`) y lo asocia al
evento `alert.emitted` consumido por `mapa` (doc 08, corrección del 8 sep).

### Por qué NO se reusa `/topic/suministros`

`/topic/suministros` significa "inventario y semáforo actualizados". El front
solo re-lee el mapa con un frame que **valida como item**
(`Front_NexoVital/src/features/recursos/use-suministros-sync.ts:26-32`: el
`onUpsert` que dispara `mapa.refresh` está dentro del `if (item)`). Por lo tanto:

- publicar un payload de alerta en ese canal lo descartaría `fromWireInventario`
  (`inventory-api.ts:47-62`) y el mapa **no** se re-leería; y
- publicar el item del despacho rechazado en ese canal afirmaría un cambio de
  stock que **no ocurrió** (el CAS revirtió), que es semántica falsa.

## Payload publicado

`AlertaEscasezPushListener.AlertaEscasezPushPayload`:
`{centroAcopioId, itemId, nombre, cantidadSolicitada, disponibleActual, faltante, creadaEn}`.
La proyección de alerta del mapa solo viaja por `GET /api/v1/mapa`, así que el
frame es la **señal** para volver a leerla; además lleva el recurso, la demanda y
el faltante para un suscriptor que los quiera sin una segunda lectura.

## Delta de contrato

`arws-inception/contract/README.md` **no lista todavía** el canal dedicado de
alertas (su tabla de canales STOMP no lo incluye). Se declara como **delta**: el
nombre existe en el `system-design`, no en el contrato REST/STOMP. El contrato
`contract/README.md` describe STOMP, así que se respeta su semántica y se **no**
se sobrecarga `/topic/suministros`.

## Consumidor del front

`useAlertasEscasezSync` (`Front_NexoVital/src/features/recursos/`) se suscribe a
`/topic/alerts` y dispara el `refresh` del mapa, cableado dentro de
`useInventario` junto al canal de suministros. La alerta se sigue creando igual,
el despacho sigue devolviendo `409 STOCK_INSUFICIENTE` y la alerta se sigue
limpiando sola al cubrir el faltante.

## Verificación

- `mvn test`: 155 tests, 0 fallos (incluye 2 tests nuevos en
  `AlertaEscasezTest` que fijan la emisión post-commit y la no-emisión cuando la
  alerta no cambia).
- `npm test`: 60 archivos, 583 tests; `npm run test:e2e`: 4 pasan.
- En vivo: `stomp-alert-verify.mjs` captura el frame real en `/topic/alerts`
  (~20 ms después del 409) y `scripts/prueba-funcional-alerta-escasez.ps1`
  recorre el ciclo completo (409 → alerta → donación → se limpia sola).

---

## Delta 2026-10-05 — una sola alerta por item bajo concurrencia (M-05)

**Problema.** `RegistrarAlertaEscasezUseCaseImpl` buscaba la alerta y, si no la
encontraba, la creaba. Son dos pasos: con varios rechazos simultáneos del mismo
item (el escenario de 5 solicitantes, o los 97 rechazos de `DespachoConcurrenciaTest`)
todos podían buscar antes de que alguno creara, y cada uno dejaba su fila. El
contador de alertas del centro quedaba inflado. Además, subir la demanda era
leer-comparar-escribir en Java, así que una demanda menor podía pisar a una mayor.

**Solución.**

| Pieza | Cambio |
|---|---|
| `alertas_escasez` | Restricción única `uk_alerta_escasez_centro_item` sobre `(centro_acopio_id, item_id)`. |
| Crear | `saveAndFlush`: si otro rechazo ya insertó la alerta, falla ahí mismo con error de integridad. |
| Subir la demanda (FA-4) | Un solo `UPDATE … WHERE cantidad_solicitada < :nueva`. Nunca baja. |
| Reabrir una alerta cubierta | Un solo `UPDATE … WHERE cantidad_solicitada = :leida` (comparar y escribir). |
| Reintento | Quien pierde una carrera reintenta en una transacción NUEVA (hasta 5 veces) y encuentra la fila del ganador. |

**Por qué `TransactionTemplate` y no `@Transactional`.** El reintento necesita una
transacción nueva por intento: la que chocó con la restricción única ya quedó
marcada para revertirse. La plantilla usa `REQUIRES_NEW`, así que FA-6 no cambia:
la alerta sigue sobreviviendo al rollback del despacho.

**Push.** Sin cambios de contrato. El evento se publica dentro del intento que
escribe, así que sale una vez por cambio real y nunca por un intento fallido.

**Si se agotan los intentos** se registra un aviso en el log y el despacho sigue
respondiendo `409`: un fallo al guardar la alerta no debe convertir el rechazo
en un `500`.

**Base de datos.** Con H2 y `create-drop` la restricción se crea sola al arrancar.
El día que exista PostgreSQL con `ddl-auto=validate` hay que agregarla en la
migración y, si ya hubiera filas duplicadas, dejar por item la de mayor demanda.

**Pruebas** (`DespachoConcurrenciaTest`):

- C1 ahora también afirma que los 97 rechazos dejan **una** alerta.
- Caso nuevo: 40 rechazos concurrentes con demandas de 4 a 43 sobre stock 3 dejan
  una sola alerta, con demanda 43.
