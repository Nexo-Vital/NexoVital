# Base de datos distribuida con Citus

Este documento explica cómo se escala horizontalmente la base de datos de NexoVital, por qué
la llave de sharding es la que es, y qué hace Uber en el mismo problema.

## Cómo lo hace Uber (y qué se puede copiar)

Uber no usa Citus. Su camino fue:

1. **Un Postgres único** que se quedó corto con el crecimiento.
2. **Sharding a nivel de aplicación**: construyeron *Schemaless* sobre MySQL y después
   *Docstore*. La app sabe en qué shard vive cada dato; no hay un coordinador que reparta SQL.
3. **Llave de sharding: la ciudad.** Un viaje, su conductor y su pago viven en el mismo shard,
   así que el camino caliente (crear viaje, asignar conductor, actualizar posición) no cruza
   shards. Es la misma idea que el `ciudad_id` de este proyecto.
4. **Un mapa de shards** que dice qué nodo tiene cada ciudad; mover una ciudad de nodo es una
   operación de datos, no un cambio de código.
5. **Las invariantes globales viven en un solo lugar.** Lo que no se puede repartir (un registro
   único, un contador global) queda en un servicio o tabla aparte, fuera del camino caliente.

Lo difícil no es el motor: es **elegir la llave**, **mover shards** y **evitar operaciones que
crucen shards**. Citus aplica la misma idea dentro de PostgreSQL: una columna de distribución,
co-locación de tablas que se tocan juntas, tablas de referencia para catálogos chicos, y
consultas *router* (un shard) vs *multi-shard* (todos).

## Qué se implementó acá

Topología (`deploy/citus/docker-compose.citus.yml`, override del compose normal):

```
                    ┌──────────────────────────────┐
   app  ──────────► │  db (coordinador Citus)      │
                    │  puerto 5432                 │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
             ┌─────────────┐                ┌─────────────┐
             │ db-worker-1 │                │ db-worker-2 │
             └─────────────┘                └─────────────┘
```

Distribución (`deploy/citus/distribuir.sql`):

| Tabla | Tipo | Llave |
|---|---|---|
| `flota.ambulancias` | distribuida | `id` |
| `flota.solicitudes_ambulancia` | distribuida | `id` |
| `flota.solicitud_ambulancia_notificadas` | distribuida, co-localizada | `solicitud_id` |
| `flota.solicitud_ambulancia_rechazos` | distribuida, co-localizada | `solicitud_id` |
| `mapa.zonas`, `mapa.zona_vertices` | referencia | — |
| `usuarios`, `recursos`, `auditoria`, `mapa.emergencias` | local al coordinador | — |

### Por qué por `id` y no por ciudad

Citus exige que **todo `UNIQUE`/`PRIMARY KEY` incluya la columna de distribución**. Hoy las
tablas grandes tienen PK simple (`id`): distribuir por ciudad obligaría a una PK compuesta
`(ciudad_id, id)` y a tocar el modelo de datos y las consultas. Distribuir por `id` mantiene el
esquema actual y ya reparte filas y escrituras entre los dos workers.

El costo de esta decisión:

- Toda consulta **por id** es *router* (un solo shard): es el caso de la actualización de
  posición y del accept de una solicitud.
- Los **listados sin filtro** (por ejemplo, la flota completa) son *multi-shard*: Citus los
  manda a los cuatro shards y junta el resultado.
- **No hay localidad por ciudad.** El diseño completo por ciudad está en el laboratorio
  `citus-lab/` de la rama `feature/postgres-distribuido-citus`, con PK compuesta y
  co-localización.

### Cambio de esquema asociado

`flota.ambulancias` tenía `UNIQUE (placa)`. Esa restricción no incluye `id`, así que Citus no
permite distribuir la tabla. Se retiró del modelo (`AmbulanciaJpaEntity`) y del esquema. La
placa **no se crea por API**: solo la siembra el seeder, que usa `findByPlaca` para no duplicar
la semilla. Si en el futuro se agrega un alta de ambulancias, la unicidad debe validarse en el
caso de uso.

## Cómo correrlo

```powershell
# 1. Levanta coordinador + workers, arranca el backend para crear el esquema y
#    distribuye las tablas.
.\deploy\citus\levantar.ps1

# 2. Evidencia: nodos, shards, conteos y planes.
.\deploy\citus\verificar.ps1

# 3. Apagar todo (sin borrar datos).
docker compose -f docker-compose.yml -f deploy/citus/docker-compose.citus.yml down
```

La app no cambia: usa `NEXOVITAL_DB_URL=jdbc:postgresql://db:5432/nexovital` (el coordinador).

## Evidencia de la corrida (2026-11-08)

- 2 workers activos (`db-worker-1`, `db-worker-2`), 10 shards en cada uno.
- 6 tablas en el catálogo de Citus: 4 distribuidas y 2 de referencia.
- El esquema real (11 tablas de `flota`, `mapa`, `usuarios`, `recursos`, `auditoria`) fue creado
  por la app con `ddl-auto=update` y luego distribuido.
- El backend arrancó sobre el esquema distribuido en 16,9 s, sin errores de esquema.
- Plan de una consulta por `id`: **Task Count: 1** (un worker).
- Plan sin filtro: **Task Count: 4** (los cuatro shards).

## Límites del prototipo

- Los workers usan `POSTGRES_HOST_AUTH_METHOD=trust` en la red interna de Docker: es una
  comodidad de laboratorio local, no una configuración de producción.
- `citus.shard_count = 4` para que la demo sea legible; en producción se elige según el volumen.
- No se demuestra el rebalanceo de shards en caliente ni la recuperación de un worker caído.
- La llave por ciudad (la de Uber) requiere la migración a PK compuesta descrita arriba.
