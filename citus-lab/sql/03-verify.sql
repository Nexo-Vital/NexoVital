-- ==========================================================================
-- 03-verify.sql - comprueba que el cluster y la distribucion existen.
--
-- Lo importante de este archivo es el EXPLAIN:
--   * router query (con ciudad_id)  -> Task Count: 1
--   * multi-shard (sin ciudad_id)   -> Task Count: 4
-- Esa diferencia es la que explica el costo del ping del mapa.
-- ==========================================================================

\set ON_ERROR_STOP on

\echo '== Nodos del cluster =='
SELECT nodename, nodeport, isactive
FROM pg_dist_node
ORDER BY nodename;

\echo '== Tablas y tipo de distribucion =='
SELECT table_name, citus_table_type, distribution_column
FROM citus_tables
ORDER BY table_name;

\echo '== Shards y worker que los tiene =='
SELECT shardid, shard_name, nodename
FROM citus_shards
ORDER BY shardid;

\echo '== Filas por ciudad (debe haber 25 por ciudad) =='
SELECT ciudad_id, count(*) AS ambulancias
FROM flota.ambulancias
GROUP BY ciudad_id
ORDER BY ciudad_id;

\echo '== PLAN ROUTER: filtra por ciudad_id + id -> Task Count: 1 =='
EXPLAIN (COSTS OFF)
SELECT *
FROM flota.ambulancias
WHERE ciudad_id = '11111111-1111-1111-1111-111111111111'
  AND id = '00000001-0000-0000-0000-000000000001';

\echo '== PLAN MULTI-SHARD: solo id, sin ciudad_id -> Task Count: 4 =='
EXPLAIN (COSTS OFF)
SELECT *
FROM flota.ambulancias
WHERE id = '00000001-0000-0000-0000-000000000001';

\echo '== PLAN AGREGADO GLOBAL: count(*) -> Task Count: 4 =='
EXPLAIN (COSTS OFF)
SELECT count(*) FROM flota.ambulancias;
