-- ==========================================================================
-- 01-init.sql - esquema distribuido del laboratorio Citus.
--
-- Se ejecuta en el COORDINADOR, contra la base `nexovital`.
-- Los workers se agregan al cluster y despues se crean las tablas.
--
-- Decision de diseno: distribuir por `ciudad_id`.
--   * `flota.ambulancias` y `flota.solicitudes_ambulancia` comparten la
--     columna de distribucion, asi que quedan CO-LOCALIZADAS: el accept de una
--     ambulancia toca filas del mismo shard y la transaccion es local.
--   * `mapa.zonas` es una tabla de REFERENCIA: se copia a todos los workers.
--   * `flota.misiones_activas` es LOCAL al coordinador: es el registro global
--     que garantiza C2 (una ambulancia <= 1 mision) aunque las tablas grandes
--     esten repartidas.
-- ==========================================================================

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS citus;

-- 4 shards para las 4 ciudades del laboratorio. El default de Citus es 32;
-- se baja para que la demo sea legible (Task Count: 4 en las multi-shard).
SET citus.shard_count = 4;

-- Agregar workers de forma idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_dist_node WHERE nodename = 'citus-worker-1') THEN
    PERFORM citus_add_node('citus-worker-1', 5432);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_dist_node WHERE nodename = 'citus-worker-2') THEN
    PERFORM citus_add_node('citus-worker-2', 5432);
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS flota;
CREATE SCHEMA IF NOT EXISTS mapa;

-- Re-ejecutable: se recrean las tablas del laboratorio.
DROP TABLE IF EXISTS flota.misiones_activas;
DROP TABLE IF EXISTS flota.solicitudes_ambulancia;
DROP TABLE IF EXISTS flota.ambulancias;
DROP TABLE IF EXISTS mapa.zonas;

-- --------------------------------------------------------------------------
-- Ambulancias: distribuida por ciudad.
-- La PK incluye la columna de distribucion (requisito de Citus).
-- --------------------------------------------------------------------------
CREATE TABLE flota.ambulancias (
  id                 uuid        NOT NULL,
  ciudad_id          uuid        NOT NULL,
  placa              text        NOT NULL,
  estado             text        NOT NULL,
  lat                double precision,
  lng                double precision,
  ultima_posicion_en timestamptz,
  PRIMARY KEY (ciudad_id, id)
);

SELECT create_distributed_table('flota.ambulancias', 'ciudad_id');

-- --------------------------------------------------------------------------
-- Solicitudes: misma distribucion -> co-localizadas con las ambulancias.
-- --------------------------------------------------------------------------
CREATE TABLE flota.solicitudes_ambulancia (
  id            uuid        NOT NULL,
  ciudad_id     uuid        NOT NULL,
  ambulancia_id uuid,
  estado        text        NOT NULL,
  creada_en     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ciudad_id, id)
);

SELECT create_distributed_table('flota.solicitudes_ambulancia', 'ciudad_id');

-- --------------------------------------------------------------------------
-- Zonas: catalogo chico y de lectura -> tabla de referencia.
-- --------------------------------------------------------------------------
CREATE TABLE mapa.zonas (
  id        uuid NOT NULL PRIMARY KEY,
  ciudad_id uuid NOT NULL,
  nombre    text NOT NULL
);

SELECT create_reference_table('mapa.zonas');

-- --------------------------------------------------------------------------
-- Registro global de misiones (C2). Vive SOLO en el coordinador.
-- El CAS es el INSERT ... ON CONFLICT (ambulancia_id).
-- --------------------------------------------------------------------------
CREATE TABLE flota.misiones_activas (
  ambulancia_id uuid        NOT NULL PRIMARY KEY,
  solicitud_id  uuid        NOT NULL UNIQUE,
  ciudad_id     uuid        NOT NULL,
  creada_en     timestamptz NOT NULL DEFAULT now()
);

\echo 'Esquema distribuido creado.'
