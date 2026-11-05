-- ==========================================================================
-- 02-seed.sql - datos reproducibles para el laboratorio.
--
-- 4 ciudades x 25 ambulancias = 100 ambulancias.
-- 4 ciudades x 20 solicitudes = 80 solicitudes.
-- IDs deterministas para poder escribir consultas de router sin buscar antes.
-- ==========================================================================

\set ON_ERROR_STOP on

-- Ciudades (UUID fijos)
--   1111... Norte
--   2222... Sur
--   3333... Centro
--   4444... Occidente

INSERT INTO mapa.zonas (id, ciudad_id, nombre) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Zona Norte'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Zona Sur'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Zona Centro'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'Zona Occidente')
ON CONFLICT (id) DO NOTHING;

-- Ambulancias: id = 0000000N-0000-0000-0000-0000000000GG
-- Ejemplo: ciudad 1, ambulancia 1 -> 00000001-0000-0000-0000-000000000001
INSERT INTO flota.ambulancias (id, ciudad_id, placa, estado, lat, lng, ultima_posicion_en)
SELECT
  ('0000000' || c.n || '-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  c.ciudad_id,
  'AMB-' || c.n || '-' || lpad(g::text, 3, '0'),
  'DISPONIBLE',
  4.60 + (random() * 0.10),
  -74.10 + (random() * 0.10),
  now()
FROM (VALUES
  (1, '11111111-1111-1111-1111-111111111111'::uuid),
  (2, '22222222-2222-2222-2222-222222222222'::uuid),
  (3, '33333333-3333-3333-3333-333333333333'::uuid),
  (4, '44444444-4444-4444-4444-444444444444'::uuid)
) AS c(n, ciudad_id)
CROSS JOIN generate_series(1, 25) AS g
ON CONFLICT (ciudad_id, id) DO NOTHING;

-- Solicitudes: id = 5000000N-0000-0000-0000-0000000000GG
INSERT INTO flota.solicitudes_ambulancia (id, ciudad_id, ambulancia_id, estado)
SELECT
  ('5000000' || c.n || '-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  c.ciudad_id,
  NULL,
  'PENDIENTE'
FROM (VALUES
  (1, '11111111-1111-1111-1111-111111111111'::uuid),
  (2, '22222222-2222-2222-2222-222222222222'::uuid),
  (3, '33333333-3333-3333-3333-333333333333'::uuid),
  (4, '44444444-4444-4444-4444-444444444444'::uuid)
) AS c(n, ciudad_id)
CROSS JOIN generate_series(1, 20) AS g
ON CONFLICT (ciudad_id, id) DO NOTHING;

\echo 'Datos sembrados: 100 ambulancias, 80 solicitudes, 4 zonas.'
