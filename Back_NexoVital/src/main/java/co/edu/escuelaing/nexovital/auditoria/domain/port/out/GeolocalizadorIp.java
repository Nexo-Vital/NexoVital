package co.edu.escuelaing.nexovital.auditoria.domain.port.out;

/**
 * Resuelve el país de una IP para la bitácora (S-2).
 */
public interface GeolocalizadorIp {

    /** IP privada o de loopback: la petición no vino de internet. */
    String PAIS_RED_LOCAL = "LOCAL";

    /** No se pudo resolver: IP pública sin datos, o sin base de países cargada. */
    String PAIS_DESCONOCIDO = "DESCONOCIDO";

    /**
     * Código ISO 3166-1 alfa-2 del país ({@code CO}, {@code US}, ...),
     * {@link #PAIS_RED_LOCAL} o {@link #PAIS_DESCONOCIDO}. Nunca {@code null} y
     * nunca lanza excepción: la bitácora no puede perder una fila por el país.
     */
    String paisDe(String ip);
}
