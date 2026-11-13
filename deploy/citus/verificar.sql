-- ==========================================================================
-- verificar.sql — evidencia de que la base está distribuida de verdad.
--
--   Get-Content -Raw deploy\citus\verificar.sql |
--     docker compose -f docker-compose.yml -f deploy/citus/docker-compose.citus.yml `
--       exec -T db psql -U nexovital -d nexovital
--
-- Lo que hay que mirar:
--   * dos workers activos;
--   * las tablas grandes `distributed` y los catálogos `reference`;
--   * shards repartidos entre los dos workers;
--   * una consulta por id -> Task Count: 1 (router, un solo worker);
--   * una consulta sin filtro -> Task Count: 4 (multi-shard).
-- ==========================================================================

\set ON_ERROR_STOP on

\echo '== Nodos del cluster =='
SELECT nodename, nodeport, isactive
FROM pg_dist_node
ORDER BY nodename;

\echo '== Tablas y tipo de distribucion =='
SELECT table_name::text AS tabla, citus_table_type, distribution_column
FROM citus_tables
ORDER BY 1;

\echo '== Shards por worker =='
SELECT nodename, count(*) AS shards
FROM citus_shards
GROUP BY nodename
ORDER BY nodename;

\echo '== Filas en las tablas grandes =='
SELECT count(*) AS ambulancias FROM flota.ambulancias;
SELECT count(*) AS solicitudes FROM flota.solicitudes_ambulancia;

\echo '== PLAN ROUTER (por id): Task Count debe ser 1 =='
SELECT id AS id_demo FROM flota.ambulancias LIMIT 1 \gset
EXPLAIN (COSTS OFF)
SELECT * FROM flota.ambulancias WHERE id = :'id_demo';

\echo '== PLAN MULTI-SHARD (sin filtro): Task Count debe ser 4 =='
EXPLAIN (COSTS OFF)
SELECT * FROM flota.ambulancias;
