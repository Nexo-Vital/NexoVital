package co.edu.escuelaing.nexovital.mapa.domain.model;

/**
 * Severidad de una emergencia (contrato OpenAPI, schema
 * {@code NivelEmergencia}). Los valores son literalmente los del contrato: no
 * se inventa ninguno.
 *
 * <p>El nivel dice qué tan grave es la emergencia; QUÉ es la emergencia lo dice
 * {@link TipoEmergencia}, y {@code descripcion} es el comentario libre.
 */
public enum NivelEmergencia {
    BAJO,
    MEDIO,
    ALTO,
    CRITICO
}
