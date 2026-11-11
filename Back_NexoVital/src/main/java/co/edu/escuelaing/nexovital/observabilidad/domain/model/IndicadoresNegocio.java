package co.edu.escuelaing.nexovital.observabilidad.domain.model;

import java.util.Map;
import java.util.Objects;

/**
 * Foto de los indicadores del tablero de negocio (Sprint 2, T40), leída de la
 * base de datos en un instante.
 *
 * <p>Los valores salen de lo persistido, no de contadores en memoria: así
 * coinciden con la base aunque una instancia se reinicie o el tráfico se reparta
 * entre dos nodos (T43). Los usuarios activos no están aquí porque no viven en la
 * base: son las sesiones STOMP abiertas, que ya publica {@code MetricasNegocio}.
 *
 * @param emergenciasReportadas      filas de {@code mapa.emergencias}
 * @param donacionesCompletadas      donaciones acreditadas ({@code INSUMO_DONADO}
 *                                   en la bitácora)
 * @param asignacionesMedidas        asignaciones de ambulancia con las que se
 *                                   calculó el promedio
 * @param segundosPromedioAsignacion tiempo medio entre que se pide la ambulancia
 *                                   y una unidad la acepta; {@code NaN} si aún no
 *                                   hay ninguna asignación
 * @param centrosPorSemaforo         centros con inventario por su peor nivel
 *                                   ({@code ROJO}, {@code AMARILLO},
 *                                   {@code VERDE}, {@code COMPLETO})
 */
public record IndicadoresNegocio(
        long emergenciasReportadas,
        long donacionesCompletadas,
        long asignacionesMedidas,
        double segundosPromedioAsignacion,
        Map<String, Long> centrosPorSemaforo) {

    public IndicadoresNegocio {
        Objects.requireNonNull(centrosPorSemaforo, "centrosPorSemaforo es obligatorio");
        centrosPorSemaforo = Map.copyOf(centrosPorSemaforo);
    }

    /** Centros en un nivel del semáforo; 0 si no hay ninguno. */
    public long centrosEn(String nivel) {
        return centrosPorSemaforo.getOrDefault(nivel, 0L);
    }
}
