# Tableros de observabilidad (EP-06.F5.US2 y F5.US3)

Escenario de calidad **O-1**: el sistema recolecta métricas, las muestra en dos tableros y la degradación se ve en el tablero técnico en **30 s o menos**. El estado de cada componente es visible en todo momento.

- **Herramienta (T36):** Micrometer en cada backend → Prometheus (raspa cada instancia por separado, etiqueta `instancia`) → Grafana.
- **Dónde corren:** en el `docker-compose.yml` (Prometheus en `:9090`, Grafana en `:3000`, usuario `admin`, contraseña `GRAFANA_PASSWORD` o `nexovital`). Los tableros se cargan solos desde `deploy/grafana/dashboards`.
- **En Azure** no se despliegan Prometheus ni Grafana. El backend sí publica las mismas métricas en `/actuator/prometheus`.

## 1. Tablero técnico (T38)

Archivo `deploy/grafana/dashboards/tecnico.json`, refresco cada 5 s.

| Panel | Qué pide el PDF | Métrica / consulta |
|---|---|---|
| Estado de componentes | Estado de cada componente visible en todo momento | `up{job="nexovital-backend"}` por instancia y `min by (componente) (nexovital_componente_disponible)` para `base_datos` y `rabbitmq` |
| Tiempo de respuesta promedio | Tiempo de respuesta promedio | `rate(http_server_requests_seconds_sum[1m]) / rate(..._count[1m])` por instancia, sin `/actuator` ni `/ws`; también el p95 |
| Latencia de eventos en tiempo real | Latencia de eventos en tiempo real | p95 y promedio de `nexovital_push_propagacion_seconds` (objetivo R-1: p95 ≤ 500 ms) |
| Usuarios concurrentes | Usuarios concurrentes | `nexovital_usuarios_stomp`, total y por instancia |
| CPU / Memoria del heap | Consumo de CPU y memoria | `process_cpu_usage`, `jvm_memory_used_bytes{area="heap"}` |
| Errores 5xx (5 min) y por minuto | Cantidad de errores | `increase(http_server_requests_seconds_count{status=~"5.."}[...])` |
| Pool de conexiones, cola STOMP | Apoyo para diagnosticar | `hikaricp_connections_*`, `executor_queued_tasks` |

### Métricas nuevas del Sprint 2

| Métrica | Dónde se mide | Qué significa |
|---|---|---|
| `nexovital_push_propagacion_seconds` (timer, etiqueta `origen`) | `PushFanOutAdapter.entregarLocal` | Tiempo desde que una instancia publica un evento (`emitidoEn`) hasta que la instancia que lo entrega lo pone en el canal de sus clientes. Incluye el salto por RabbitMQ. Reemplaza al panel anterior, que usaba la latencia HTTP de `POST /posicion` (hallazgo H6). |
| `nexovital_componente_disponible{componente}` (gauge 1/0) | `EstadoComponentes` | Cada 5 s el backend comprueba la base de datos (`SELECT 1`) y RabbitMQ. Si no contestan en 2 s, se marcan caídos sin esperar los 30 s del pool. |

### Por qué se ve en 30 s o menos (T39)

| Paso | Tiempo máximo |
|---|---|
| Prometheus raspa los backends | cada 5 s (`scrape_interval`), con 4 s de tiempo límite |
| `EstadoComponentes` comprueba la base y RabbitMQ | cada 5 s + 2 s de tiempo límite |
| Grafana refresca el tablero | cada 5 s |
| Ventanas de tasa (`rate`, `increase`) | 1 min, para que una subida de latencia o de errores se note en segundos |

Peor caso teórico de una instancia caída: 5 + 4 + 5 = 14 s. De la base o RabbitMQ: 5 + 2 + 5 + 5 = 17 s.

**Prueba (T39):** `deploy/prometheus/probar-degradacion.sh backend-2` (también `db` y `rabbitmq`). Detiene el componente, mide cuándo Prometheus lo ve caído y lo vuelve a levantar.

| Componente | Prometheus lo vio caído a los | En el tablero (+5 s) | Resultado |
|---|---|---|---|
| backend-2 | 2 s y 5 s (dos corridas) | 7 s y 10 s | CUMPLE |
| db | 6 s | 11 s | CUMPLE |
| rabbitmq | 4 s | 9 s | CUMPLE |

## 2. Tablero de negocio (T40, T41, T42)

Archivo `deploy/grafana/dashboards/negocio.json`, refresco cada 10 s.

### Definición de indicadores y fuente de datos (T40)

| Indicador (PDF) | Métrica en Prometheus | Fuente de datos |
|---|---|---|
| Usuarios activos | `sum(nexovital_usuarios_stomp)` | Sesiones autenticadas abiertas en el canal en tiempo real (en memoria de cada instancia; se suman) |
| Emergencias reportadas | `max(nexovital_negocio_emergencias_reportadas)` | `SELECT COUNT(*) FROM mapa.emergencias` |
| Donaciones completadas | `max(nexovital_negocio_donaciones_completadas)` | Filas `INSUMO_DONADO` en `auditoria_eventos` (una por donación acreditada, en la misma transacción) |
| Tiempo promedio de asignación de ambulancia | `max(nexovital_negocio_asignacion_segundos_promedio)` | Para cada fila `AMBULANCIA_ASIGNADA` de la bitácora: `ocurrido_en − solicitada_en` de la solicitud indicada en el `detalle` |
| Centros por color de semáforo | `max by (semaforo) (nexovital_negocio_centros)` | El mismo cálculo del mapa (`ConsultarSemaforoCentrosUseCase`): cada centro con inventario en el nivel de su ítem más escaso |

### Cómo se exponen (T41)

- `IndicadoresNegocioQueryAdapter` lee la base (consultas de una sola tabla; el cruce del promedio se hace en Java para que funcione igual en H2, PostgreSQL y Citus).
- `IndicadoresNegocioMetricas` guarda una foto cada 10 s y los gauges solo leen esa foto: un raspado nunca consulta la base.
- Los indicadores salen de la base, no de contadores en memoria. Por eso no se reinician si un backend se reinicia, y las dos instancias publican el mismo valor. El tablero usa `max()` y no `sum()`.
- Antes del Sprint 2, "Emergencias reportadas" contaba todas las peticiones `POST /emergencias` (incluidos 400, 403 y 429) y faltaban donaciones, tiempo de asignación y semáforo.

## 3. Los indicadores coinciden con la base (T43)

**Automática:** `IndicadoresNegocioQueryAdapterTest` (consultas contra H2) e `IndicadoresNegocioMetricasTest` (donación real por HTTP y comparación de cada gauge con los repositorios JPA).

**Manual (docker compose):** comparar cada número del tablero con la base.

```bash
docker compose exec db psql -U nexovital -d nexovital -c "SELECT COUNT(*) AS emergencias FROM mapa.emergencias;"
docker compose exec db psql -U nexovital -d nexovital -c "SELECT COUNT(*) AS donaciones FROM auditoria_eventos WHERE accion = 'INSUMO_DONADO';"
docker compose exec db psql -U nexovital -d nexovital -c "SELECT COUNT(*) AS asignaciones, ROUND(AVG(EXTRACT(EPOCH FROM a.ocurrido_en - s.solicitada_en))::numeric, 1) AS segundos_promedio FROM auditoria_eventos a JOIN flota.solicitudes_ambulancia s ON a.detalle LIKE 'solicitud=' || s.id || ' %' WHERE a.accion = 'AMBULANCIA_ASIGNADA';"
```

| Indicador | Tablero | Base de datos | ¿Coincide? |
|---|---|---|---|
| Emergencias reportadas | 1 | 1 | Sí |
| Donaciones completadas | 1 | 1 | Sí |
| Tiempo promedio de asignación | 3,5 s (1 asignación) | 3,5 s | Sí |
| Centros por semáforo | 1 crítico, 1 en alerta, 0 estable, 1 completo | Coincide con el mapa (Tibabuyes: Completo) | Sí |
