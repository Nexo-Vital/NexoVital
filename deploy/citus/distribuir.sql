-- ==========================================================================
-- distribuir.sql — convierte el esquema real de NexoVital en un esquema
-- distribuido de Citus, sin tocar el código de la aplicación.
--
-- Requisitos:
--   1. El coordinador (db) y los dos workers (db-worker-1/2) están arriba:
--      docker compose -f docker-compose.yml -f deploy/citus/docker-compose.citus.yml up -d
--   2. El esquema ya existe (la app lo crea con ddl-auto=update al arrancar).
--
-- Qué se distribuye y por qué:
--   * flota.solicitudes_ambulancia  -> por id. Es la tabla de escritura caliente
--     del ciclo de la solicitud; toda consulta/UPDATE por id es router (1 shard).
--   * flota.solicitud_ambulancia_notificadas y _rechazos -> por solicitud_id,
--     co-localizadas con solicitudes (la FK se resuelve dentro del shard).
--   * flota.ambulancias -> por id. Toda escritura de posición va por id.
--   * mapa.zonas / mapa.zona_vertices -> tablas de REFERENCIA (catálogo chico).
--   * El resto (usuarios, recursos, auditoría, emergencias) queda local al
--     coordinador: son catálogos o tablas que no crecen con la flota.
--
-- Llave de sharding: hoy es el id, no la ciudad. El diseño por ciudad exige que
-- la PK sea compuesta (ciudad_id, id) en las tablas grandes; el laboratorio
-- `citus-lab/` de la rama feature/postgres-distribuido-citus muestra ese
-- diseño. Distribuir por id mantiene las PK actuales y ya reparte filas y
-- escrituras entre los dos workers.
--
-- Es idempotente: se puede volver a correr.
-- ==========================================================================

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS citus;

SET citus.shard_count = 4;

-- Workers (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_dist_node WHERE nodename = 'db-worker-1') THEN
    PERFORM citus_add_node('db-worker-1', 5432);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_dist_node WHERE nodename = 'db-worker-2') THEN
    PERFORM citus_add_node('db-worker-2', 5432);
  END IF;
END $$;

-- Citus no admite UNIQUE/PRIMARY KEY que no incluyan la columna de
-- distribución. `ambulancias` tiene un UNIQUE(placa) que no incluye `id`; la
-- placa no se crea por API, así que se retira esa restricción de base. Solo se
-- tocan las restricciones que NO contienen `id`: si mañana se agrega un UNIQUE
-- que sí incluya la columna de distribución, Citus lo acepta y se respeta.
DO $$
DECLARE restriccion record;
BEGIN
  FOR restriccion IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'flota.ambulancias'::regclass
      AND contype = 'u'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(conkey) AS columna
        JOIN pg_attribute atributo
          ON atributo.attrelid = conrelid AND atributo.attnum = columna
        WHERE atributo.attname = 'id'
      )
  LOOP
    EXECUTE format('ALTER TABLE flota.ambulancias DROP CONSTRAINT %I', restriccion.conname);
  END LOOP;
END $$;

-- Catálogos chicos: referencia (se copian a todos los workers).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'mapa.zonas') THEN
    PERFORM create_reference_table('mapa.zonas');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'mapa.zona_vertices') THEN
    PERFORM create_reference_table('mapa.zona_vertices');
  END IF;
END $$;

-- Placas registradas (Sprint 2, T10): tabla de referencia. Su clave primaria
-- (la placa) es la que garantiza que dos conductores no queden con la misma
-- placa; flota.ambulancias no puede tener ese UNIQUE porque se distribuye por
-- id. Una tabla de referencia se replica en todos los nodos y SI admite clave
-- unica. Solo se convierte si Hibernate ya la creo (ddl-auto=update).
DO $$
BEGIN
  IF to_regclass('flota.placas') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'flota.placas') THEN
    PERFORM create_reference_table('flota.placas');
  END IF;
END $$;

-- Tablas grandes: distribuidas por id.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'flota.solicitudes_ambulancia') THEN
    PERFORM create_distributed_table('flota.solicitudes_ambulancia', 'id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'flota.ambulancias') THEN
    PERFORM create_distributed_table('flota.ambulancias', 'id');
  END IF;
END $$;

-- Tablas hijas co-localizadas con solicitudes por solicitud_id.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'flota.solicitud_ambulancia_notificadas') THEN
    PERFORM create_distributed_table(
      'flota.solicitud_ambulancia_notificadas', 'solicitud_id',
      colocate_with => 'flota.solicitudes_ambulancia');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM citus_tables WHERE table_name::text = 'flota.solicitud_ambulancia_rechazos') THEN
    PERFORM create_distributed_table(
      'flota.solicitud_ambulancia_rechazos', 'solicitud_id',
      colocate_with => 'flota.solicitudes_ambulancia');
  END IF;
END $$;

\echo 'Esquema distribuido listo.'
