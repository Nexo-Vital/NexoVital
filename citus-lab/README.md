# Laboratorio Citus — escalado horizontal de la base de datos

> **Estado:** laboratorio aislado de diseño. **La aplicación NO usa esto.**
> El `docker-compose.yml` de la raíz sigue corriendo con **un solo PostgreSQL**.
> Esta rama existe para responder una pregunta concreta: *si el profesor pidiera
> escalar la base de datos horizontalmente, ¿cómo se haría sin romper C1 ni C2?*

## Por qué existe

El enunciado de Sprint 2 pide:

> "Se debe plantear una arquitectura que permita escalar horizontalmente el **Backend**."
> "Debe implementarse un prototipo funcional que demuestre la escalabilidad, **distribuyendo físicamente componentes** (Ej.: Backend, Frontend, **Base de Datos**, Servicios en tiempo real)."

Y en el audio de clase el profesor agregó la idea que motiva este laboratorio:

> "Al tener balanceo de cargas y escalabilidad horizontal [...] si entra por un lado y llega a un server, y luego entra por otro y llega al otro, **no va a haber sincronía; tienes que extraer esa información**. Pueden escoger **una base de datos**, también pueden usar **caché**."

O sea: el estado que hoy vive en RAM tiene que salir a un lugar compartido. La base puede ser ese lugar. Este laboratorio muestra **cómo se distribuye esa base** si hiciera falta, y por qué la distribución correcta para NexoVital es **por ciudad**.

## Qué es Citus

Citus es una **extensión de PostgreSQL**, no una base nueva. Convierte un Postgres normal en un Postgres distribuido: seguís escribiendo SQL y usando el mismo driver, pero el **coordinador** reparte las filas entre **workers**.

```
                    ┌──────────────────────────────┐
   app  ──────────► │  coordinador (Postgres+citus)│
                    │  catálogo pg_dist_*          │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
             ┌─────────────┐                ┌─────────────┐
             │  worker-1   │                │  worker-2   │
             │ shards A, C │                │ shards B, D │
             └─────────────┘                └─────────────┘
```

### Cómo ejecuta una consulta

| Tipo de query | Qué hace Citus | Costo |
|---|---|---|
| **Router** (`WHERE ciudad_id = ?`) | Calcula el hash de la ciudad, elige **un** shard | 1 shard |
| **Multi-shard** (sin `ciudad_id`) | Manda la query a **todos** los shards y junta | N shards |
| **Co-localizada** (`ambulancias` + `solicitudes` por `ciudad_id`) | El join ocurre dentro de cada shard | 1 shard por ciudad |
| **Cross-shard** (tablas con distinta clave) | Reparte una tabla (shuffle) o trae todo al coordinador | El peor caso |

**La regla de oro:** si la query no incluye la columna de distribución, Citus no puede rutear. Por eso el `UPDATE` de posición del mapa **debe llevar `ciudad_id`**.

### Tipos de tabla que usa el laboratorio

| Tabla | Tipo | Por qué |
|---|---|---|
| `flota.ambulancias` | distribuida por `ciudad_id` | Es la tabla que más escribe (posición) y se consulta por ciudad |
| `flota.solicitudes_ambulancia` | distribuida por `ciudad_id` | Co-localizada con ambulancias: el accept toca filas del mismo shard |
| `mapa.zonas` | referencia | Catálogo chico; se copia a todos los workers |
| `flota.misiones_activas` | local al coordinador | Registro global de C2: una ambulancia ≤ 1 misión |

## Por qué por ciudad

1. **El negocio es por ciudad.** Un CRUE opera su ciudad; las ambulancias y las solicitudes de esa ciudad se tocan juntas.
2. **El accept es local.** `solicitudes_ambulancia` y `ambulancias` comparten `ciudad_id`, así que la transacción que asigna una ambulancia **no cruza shards**. No hay 2PC en el camino caliente.
3. **C2 sigue siendo global.** Aunque las tablas grandes estén repartidas, el registro `misiones_activas` vive en un solo lugar y su PK (`ambulancia_id`) es el CAS:

```sql
INSERT INTO flota.misiones_activas (ambulancia_id, solicitud_id, ciudad_id)
VALUES (:ambulancia, :solicitud, :ciudad)
ON CONFLICT (ambulancia_id) DO NOTHING;
-- 1 fila = ganó la misión; 0 filas = otra solicitud ya la tiene
```

4. **El ping del mapa no se degrada** si la escritura lleva `ciudad_id`:

```sql
UPDATE flota.ambulancias
SET lat = ?, lng = ?, ultima_posicion_en = ?
WHERE ciudad_id = ? AND id = ?;   -- router query: un solo shard
```

## Archivos

| Archivo | Qué hace |
|---|---|
| `docker-compose.yml` | Coordinador + 2 workers Citus (Postgres 16) |
| `sql/01-init.sql` | Crea la extensión, agrega workers y distribuye las tablas |
| `sql/02-seed.sql` | 4 ciudades × 25 ambulancias, 4 × 20 solicitudes, IDs deterministas |
| `sql/03-verify.sql` | Muestra nodos, shards y los planes router vs multi-shard |
| `sql/04-router.sql` | `pgbench`: `UPDATE` con `ciudad_id` |
| `sql/04-multi.sql` | `pgbench`: `UPDATE` sin `ciudad_id` |
| `setup.ps1` | Levanta, espera, inicializa y verifica |
| `measure-latency.ps1` | Compara latencia/TPS router vs multi-shard |
| `test-concurrencia.ps1` | Dos accepts concurrentes sobre la misma ambulancia |

## Cómo correrlo

```powershell
cd NexoVital\citus-lab
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

El coordinador queda en `localhost:5433` (db `nexovital`, usuario `postgres`), separado del Postgres de la app.

Después:

```powershell
# 1) Ver nodos, shards y planes
docker compose exec -T citus-coordinator psql -U postgres -d nexovital -f /lab/03-verify.sql

# 2) Medir router vs multi-shard
powershell -ExecutionPolicy Bypass -File .\measure-latency.ps1

# 3) Probar C2 con dos accepts concurrentes
powershell -ExecutionPolicy Bypass -File .\test-concurrencia.ps1

# 4) Apagar y borrar datos del laboratorio
docker compose down -v
```

## Qué demuestra

| Prueba | Evidencia esperada |
|---|---|
| Cluster activo | `pg_dist_node` muestra 3 nodos; `citus_tables` muestra 3 tablas distribuidas/referencia |
| Distribución real | `citus_shards` reparte shards entre `citus-worker-1` y `citus-worker-2` |
| Router query | `EXPLAIN` muestra **Task Count: 1** |
| Multi-shard | `EXPLAIN` muestra **Task Count: 4** |
| Ping del mapa | `pgbench` da mejor latencia/TPS con `ciudad_id` que sin él |
| C2 | Dos accepts concurrentes dejan **1** fila en `misiones_activas` |

## Resultados medidos (5 nov 2026, Docker Desktop local)

| Prueba | Resultado |
|---|---|
| `pg_dist_node` | 3 nodos activos: coordinador + `citus-worker-1` + `citus-worker-2` |
| Shards | 4 por tabla distribuida, repartidos 2/2 entre los workers |
| Router query (`ciudad_id` + `id`) | `Task Count: 1` · latencia **17,7 ms** · **564 tps** |
| Multi-shard (`id` solo) | `Task Count: 4` · latencia **72,9 ms** · **137 tps** |
| Concurrencia C2 | 2 accepts → **1 fila**; gana una sola solicitud |

**Lectura:** no incluir `ciudad_id` multiplica la latencia por ~4 y baja el throughput ~4×. Ese es el costo real de un `findById(id)` sin la columna de distribución. Es exactamente el error que hay que evitar en el `UPDATE` de posición del mapa.

## Qué NO demuestra

- **No es la arquitectura actual.** La app sigue con un solo PostgreSQL.
- **No migra datos.** Pasar la base existente a Citus requiere Flyway, `ciudad_id` en las entidades y reescritura de queries que hoy buscan solo por `id`.
- **No resuelve HA.** Si un worker se cae, sus shards no responden; para alta disponibilidad hace falta réplica por worker.
- **No cubre KPIs globales.** `COUNT/GROUP BY` sobre todas las ciudades recorre todos los shards; para eso se usa CDC a un warehouse.
- **No usa TLS ni passwords.** El laboratorio usa `trust` local. Nunca en producción.

## Trampas que hay que resolver antes de tocar la app

1. **La PK debe incluir la columna de distribución**: `PRIMARY KEY (ciudad_id, id)`, no `id` solo.
2. **Todo `findById(id)` sin `ciudad_id` se vuelve multi-shard.** Hay que pasar la ciudad o mantener un índice de ruteo.
3. **Las unique constraints deben incluir la distribución.** Por eso C2 va en una tabla local, no en una distribuida.
4. **Las FK solo funcionan entre tablas co-localizadas o contra reference tables.**
5. **`ddl-auto=update` no sirve** para esto: Hibernate crea la tabla en el coordinador y después hay que llamar `create_distributed_table`. Hay que pasar a **Flyway**.
6. **Las transacciones multi-shard usan 2PC** (`max_prepared_transactions > 0`). Si el accept es local, no se paga.
7. **El simulador y los barridos** deben ser idempotentes por shard (ADR-0009 ya lo exige).
8. **Citus rechaza funciones `VOLATILE` en `UPDATE` sobre tablas distribuidas** (`random()`, `clock_timestamp()`). El laboratorio usa valores fijos por eso. En la app la posición viene del request, no de una función SQL, así que no aplica; pero si algún día se genera un valor en SQL, hay que calcularlo antes del `UPDATE`.

## Cómo se lleva a Azure (sin servicios "flexibles")

La topología que cumple el enunciado sin auto-scale:

| VM | Qué corre |
|---|---|
| VM1 (pública) | nginx + `backend-1` + Redis (caché del mapa) + RabbitMQ |
| VM2 (privada) | `backend-2` |
| VM3 (privada) | Coordinador Citus + `worker-1` + `worker-2` |

- Todo en la **misma región y VNet**: el router query queda en 1–5 ms.
- Si el profesor exige cada shard en su propia máquina, `worker-1` y `worker-2` van a VM4 y VM5.
- Redis es la parte que el profesor mencionó como caché: acelera `GET /mapa`, no decide asignaciones.
- Nada de App Service / Container Apps / auto-scale.

## La frase para la demo

> "El escalado horizontal del backend son dos instancias detrás de nginx. Si además se pidiera escalar la base, este laboratorio muestra el diseño: Citus distribuye por ciudad, el accept queda co-localizado y C2 se sostiene con un registro global. No es la arquitectura que corre hoy; es la respuesta a '¿cómo se haría?' sin romper los invariantes."

## Referencias

- `docs/adr/0009-estado-fuera-del-proceso.md` — estado fuera del proceso.
- `docs/adr/0004-balanceador-dos-instancias.md` — escalado horizontal del backend.
- `Proyecto Sprint 2.pdf` — requisito de distribución física.
- Citus: <https://docs.citusdata.com/>
