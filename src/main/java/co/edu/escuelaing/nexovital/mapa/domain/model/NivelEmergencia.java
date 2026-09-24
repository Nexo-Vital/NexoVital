package co.edu.escuelaing.nexovital.mapa.domain.model;

/**
 * Severidad de una emergencia (contrato OpenAPI, schema
 * {@code NivelEmergencia}). Los valores son literalmente los del contrato: no
 * se inventa ninguno.
 *
 * <p>Es el "tipo" estructurado del reporte: el contrato no tiene un campo
 * {@code tipo}, solo {@code nivel} (severidad) y {@code descripcion} (texto
 * libre que nombra el tipo en lenguaje natural).
 */
public enum NivelEmergencia {
    BAJO,
    MEDIO,
    ALTO,
    CRITICO
}
