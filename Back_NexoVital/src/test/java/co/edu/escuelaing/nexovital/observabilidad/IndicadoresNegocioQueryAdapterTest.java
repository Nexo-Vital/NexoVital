package co.edu.escuelaing.nexovital.observabilidad;

import co.edu.escuelaing.nexovital.observabilidad.domain.model.IndicadoresNegocio;
import co.edu.escuelaing.nexovital.observabilidad.infrastructure.adapter.out.IndicadoresNegocioQueryAdapter;
import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Sprint 2, T41/T43: las consultas del tablero de negocio contra una base H2 con
 * solo las columnas que leen. Comprueba la sintaxis SQL y el cruce en Java del
 * tiempo de asignación, sin levantar el contexto de Spring.
 */
class IndicadoresNegocioQueryAdapterTest {

    private static final Instant BASE = Instant.parse("2026-11-10T15:00:00Z");

    private JdbcTemplate jdbc;
    private Map<UUID, Semaforo> semaforo;
    private IndicadoresNegocioQueryAdapter adapter;

    @BeforeEach
    void crearEsquema() {
        DriverManagerDataSource fuente = new DriverManagerDataSource(
                "jdbc:h2:mem:indicadores-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(fuente);
        jdbc.execute("CREATE SCHEMA mapa");
        jdbc.execute("CREATE SCHEMA flota");
        jdbc.execute("CREATE TABLE mapa.emergencias (id UUID PRIMARY KEY)");
        jdbc.execute("CREATE TABLE auditoria_eventos (id UUID PRIMARY KEY, accion VARCHAR(40) NOT NULL,"
                + " detalle VARCHAR(500), ocurrido_en TIMESTAMP(6) WITH TIME ZONE NOT NULL)");
        jdbc.execute("CREATE TABLE flota.solicitudes_ambulancia (id UUID PRIMARY KEY,"
                + " solicitada_en TIMESTAMP(6) WITH TIME ZONE NOT NULL)");
        semaforo = Map.of();
        adapter = new IndicadoresNegocioQueryAdapter(jdbc, () -> semaforo);
    }

    @Test
    @DisplayName("T43: con la base vacía, todo en 0 y el promedio sin datos")
    void baseVacia() {
        IndicadoresNegocio indicadores = adapter.consultar();

        assertEquals(0, indicadores.emergenciasReportadas());
        assertEquals(0, indicadores.donacionesCompletadas());
        assertEquals(0, indicadores.asignacionesMedidas());
        assertTrue(Double.isNaN(indicadores.segundosPromedioAsignacion()),
                "sin asignaciones no se inventa un promedio de 0 s");
        assertEquals(0, indicadores.centrosEn("ROJO"));
    }

    @Test
    @DisplayName("T43: cuenta las emergencias y solo las donaciones de la bitácora")
    void cuentaEmergenciasYDonaciones() {
        jdbc.update("INSERT INTO mapa.emergencias (id) VALUES (?)", UUID.randomUUID());
        jdbc.update("INSERT INTO mapa.emergencias (id) VALUES (?)", UUID.randomUUID());
        auditar("INSUMO_DONADO", "item=x", BASE);
        auditar("INSUMO_DONADO", "item=y", BASE);
        auditar("INSUMO_DONADO", "item=z", BASE);
        auditar("INSUMO_DESPACHADO", "item=x", BASE);
        auditar("EMERGENCIA_REPORTADA", null, BASE);

        IndicadoresNegocio indicadores = adapter.consultar();

        assertEquals(2, indicadores.emergenciasReportadas());
        assertEquals(3, indicadores.donacionesCompletadas(),
                "los despachos y los reportes no son donaciones");
    }

    @Test
    @DisplayName("T43: el tiempo de asignación es el promedio de (asignada - solicitada)")
    void promedioDeAsignacion() {
        UUID rapida = UUID.randomUUID();
        UUID lenta = UUID.randomUUID();
        UUID sinAsignar = UUID.randomUUID();
        solicitud(rapida, BASE);
        solicitud(lenta, BASE);
        solicitud(sinAsignar, BASE);
        auditar("AMBULANCIA_ASIGNADA", "solicitud=" + rapida + " ambulancia=" + UUID.randomUUID(),
                BASE.plusSeconds(10));
        auditar("AMBULANCIA_ASIGNADA", "solicitud=" + lenta + " ambulancia=" + UUID.randomUUID(),
                BASE.plusSeconds(30));
        // Un detalle que no apunta a ninguna solicitud no entra al promedio.
        auditar("AMBULANCIA_ASIGNADA", "solicitud=" + UUID.randomUUID() + " ambulancia=x",
                BASE.plusSeconds(999));

        IndicadoresNegocio indicadores = adapter.consultar();

        assertEquals(2, indicadores.asignacionesMedidas());
        assertEquals(20.0, indicadores.segundosPromedioAsignacion(), 0.001);
    }

    @Test
    @DisplayName("T43: los centros se agrupan por su nivel del semáforo")
    void centrosPorSemaforo() {
        semaforo = Map.of(
                UUID.randomUUID(), Semaforo.ROJO,
                UUID.randomUUID(), Semaforo.ROJO,
                UUID.randomUUID(), Semaforo.VERDE,
                UUID.randomUUID(), Semaforo.COMPLETO);

        IndicadoresNegocio indicadores = adapter.consultar();

        assertEquals(2, indicadores.centrosEn("ROJO"));
        assertEquals(0, indicadores.centrosEn("AMARILLO"));
        assertEquals(1, indicadores.centrosEn("VERDE"));
        assertEquals(1, indicadores.centrosEn("COMPLETO"));
    }

    private void auditar(String accion, String detalle, Instant ocurridoEn) {
        jdbc.update("INSERT INTO auditoria_eventos (id, accion, detalle, ocurrido_en) VALUES (?, ?, ?, ?)",
                UUID.randomUUID(), accion, detalle, Timestamp.from(ocurridoEn));
    }

    private void solicitud(UUID id, Instant solicitadaEn) {
        jdbc.update("INSERT INTO flota.solicitudes_ambulancia (id, solicitada_en) VALUES (?, ?)",
                id, Timestamp.from(solicitadaEn));
    }
}
