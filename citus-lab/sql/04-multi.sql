-- pgbench: ping del mapa SIN ciudad_id -> multi-shard (todos los shards).
-- Este es el error que hay que evitar en la app: buscar solo por id.
UPDATE flota.ambulancias
SET lat = 4.60,
    lng = -74.10,
    ultima_posicion_en = now()
WHERE id = '00000001-0000-0000-0000-000000000001'::uuid;
