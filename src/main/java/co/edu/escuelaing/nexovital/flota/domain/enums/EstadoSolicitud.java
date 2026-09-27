package co.edu.escuelaing.nexovital.flota.domain.enums;

/**
 * Lifecycle of an ambulance request. {@code RECHAZADA} is kept as contract
 * vocabulary, but a single unit's decline does NOT close the broadcast: the
 * request stays {@code PENDIENTE} for the other notified units (AC4).
 */
public enum EstadoSolicitud {
    PENDIENTE,
    ASIGNADA,
    CONFIRMADA,
    TOMADA,
    RECHAZADA,
    TIMEOUT
}
