package co.edu.escuelaing.nexovital.observabilidad.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.auditoria.domain.model.AccionCritica;
import co.edu.escuelaing.nexovital.observabilidad.domain.model.IndicadoresNegocio;
import co.edu.escuelaing.nexovital.observabilidad.domain.port.out.IndicadoresNegocioQueryPort;
import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarSemaforoCentrosUseCase;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

/**
 * Lee los indicadores de negocio directamente de las tablas (Sprint 2, T40,
 * T41). Es una proyección de solo lectura para el tablero: no pasa por los casos
 * de uso de escritura de cada módulo ni modifica nada.
 *
 * <p><b>Fuente de cada indicador (T40):</b>
 * <ul>
 *   <li><b>Emergencias reportadas:</b> {@code COUNT(*)} de {@code mapa.emergencias}.</li>
 *   <li><b>Donaciones completadas:</b> filas {@code INSUMO_DONADO} de
 *       {@code auditoria_eventos}. No hay tabla de donaciones: cada donación
 *       acreditada deja exactamente una fila en la bitácora, en la misma
 *       transacción del crédito (T14).</li>
 *   <li><b>Tiempo promedio de asignación:</b> para cada fila
 *       {@code AMBULANCIA_ASIGNADA} de la bitácora, su {@code ocurrido_en} menos
 *       el {@code solicitada_en} de la solicitud. La solicitud se identifica por
 *       el {@code detalle} que escribe {@code AceptarSolicitudUseCaseImpl}
 *       ({@code solicitud=<id> ambulancia=<id>}).</li>
 *   <li><b>Centros por semáforo:</b> el mismo cálculo que pinta el mapa
 *       ({@link ConsultarSemaforoCentrosUseCase}): cada centro con inventario, en
 *       el nivel de su ítem más escaso.</li>
 * </ul>
 *
 * <p>Las consultas son de una sola tabla y el cruce del promedio se hace en Java:
 * así funcionan igual en H2, en PostgreSQL y con las tablas distribuidas de
 * Citus, donde un JOIN entre tablas no colocalizadas se rechaza.
 */
@Component
public class IndicadoresNegocioQueryAdapter implements IndicadoresNegocioQueryPort {

    static final String PREFIJO_SOLICITUD = "solicitud=";

    private static final String SQL_EMERGENCIAS = "SELECT COUNT(*) FROM mapa.emergencias";
    private static final String SQL_ACCION =
            "SELECT COUNT(*) FROM auditoria_eventos WHERE accion = ?";
    private static final String SQL_ASIGNACIONES =
            "SELECT detalle, ocurrido_en FROM auditoria_eventos WHERE accion = ?";
    private static final String SQL_SOLICITUDES =
            "SELECT id, solicitada_en FROM flota.solicitudes_ambulancia";

    private final JdbcTemplate jdbcTemplate;
    private final ConsultarSemaforoCentrosUseCase semaforoCentros;

    public IndicadoresNegocioQueryAdapter(JdbcTemplate jdbcTemplate,
                                          ConsultarSemaforoCentrosUseCase semaforoCentros) {
        this.jdbcTemplate = jdbcTemplate;
        this.semaforoCentros = semaforoCentros;
    }

    @Override
    public IndicadoresNegocio consultar() {
        long emergencias = contar(SQL_EMERGENCIAS);
        long donaciones = contar(SQL_ACCION, AccionCritica.INSUMO_DONADO.name());
        List<Duration> esperas = esperasDeAsignacion();
        return new IndicadoresNegocio(
                emergencias,
                donaciones,
                esperas.size(),
                promedioSegundos(esperas),
                centrosPorSemaforo());
    }

    private long contar(String sql, Object... argumentos) {
        Long total = jdbcTemplate.queryForObject(sql, Long.class, argumentos);
        return total == null ? 0L : total;
    }

    private List<Duration> esperasDeAsignacion() {
        Map<String, Instant> solicitadas = new HashMap<>();
        jdbcTemplate.query(SQL_SOLICITUDES, (RowCallbackHandler) fila -> {
            String id = fila.getString("id");
            Instant solicitadaEn = instante(fila.getTimestamp("solicitada_en"));
            if (id != null && solicitadaEn != null) {
                solicitadas.put(id.toLowerCase(Locale.ROOT), solicitadaEn);
            }
        });

        List<Duration> esperas = new ArrayList<>();
        jdbcTemplate.query(SQL_ASIGNACIONES, (RowCallbackHandler) fila -> {
            String solicitud = solicitudDe(fila.getString("detalle"));
            Instant asignadaEn = instante(fila.getTimestamp("ocurrido_en"));
            Instant solicitadaEn = solicitud == null ? null : solicitadas.get(solicitud);
            if (asignadaEn != null && solicitadaEn != null) {
                esperas.add(Duration.between(solicitadaEn, asignadaEn));
            }
        }, AccionCritica.AMBULANCIA_ASIGNADA.name());
        return esperas;
    }

    private Map<String, Long> centrosPorSemaforo() {
        Map<String, Long> porNivel = new LinkedHashMap<>();
        for (Semaforo nivel : Semaforo.values()) {
            porNivel.put(nivel.name(), 0L);
        }
        for (Semaforo nivel : semaforoCentros.consultar().values()) {
            porNivel.merge(nivel.name(), 1L, Long::sum);
        }
        return porNivel;
    }

    /**
     * Extrae el id de la solicitud del detalle de la bitácora
     * ({@code solicitud=<id> ambulancia=<id>}); {@code null} si no lo trae.
     */
    static String solicitudDe(String detalle) {
        if (detalle == null) {
            return null;
        }
        int posicion = detalle.indexOf(PREFIJO_SOLICITUD);
        if (posicion < 0) {
            return null;
        }
        int inicio = posicion + PREFIJO_SOLICITUD.length();
        int fin = detalle.indexOf(' ', inicio);
        String id = detalle.substring(inicio, fin < 0 ? detalle.length() : fin).trim();
        return id.isEmpty() ? null : id.toLowerCase(Locale.ROOT);
    }

    /** Promedio en segundos; {@code NaN} si no hay ninguna medida. */
    static double promedioSegundos(List<Duration> esperas) {
        if (esperas.isEmpty()) {
            return Double.NaN;
        }
        long totalMs = 0;
        for (Duration espera : esperas) {
            totalMs += Math.max(0L, espera.toMillis());
        }
        return totalMs / 1000.0 / esperas.size();
    }

    private static Instant instante(Timestamp marca) {
        return marca == null ? null : marca.toInstant();
    }
}
