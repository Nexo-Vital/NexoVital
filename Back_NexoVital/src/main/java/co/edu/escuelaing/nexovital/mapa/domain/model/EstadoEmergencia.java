package co.edu.escuelaing.nexovital.mapa.domain.model;

/**
 * Estado del ciclo de vida de una emergencia (contrato OpenAPI, schema
 * {@code EstadoEmergencia}). Una emergencia recién reportada nace en
 * {@link #REGISTRADA}: es el estado que asigna el servidor, nunca el cliente.
 */
public enum EstadoEmergencia {
    REGISTRADA,
    EN_ATENCION,
    EN_ESPERA,
    RESUELTA,
    CERRADA
}
