-- pgbench: ping del mapa CON ciudad_id -> router query (un solo shard).
-- Citus no permite funciones VOLATILE (random()) en UPDATE de tablas
-- distribuidas: la posicion se actualiza con valores fijos para medir.
UPDATE flota.ambulancias
SET lat = 4.60,
    lng = -74.10,
    ultima_posicion_en = now()
WHERE ciudad_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND id = '00000001-0000-0000-0000-000000000001'::uuid;
