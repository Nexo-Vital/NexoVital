package co.edu.escuelaing.nexovital.flota.domain.enums;

/**
 * Lifecycle of an ambulance request. {@code RECHAZADA} is kept as contract
 * vocabulary, but a single unit's decline does NOT close the broadcast: the
 * request stays {@code PENDIENTE} for the other notified units (AC4). In the
 * contract it is the whole-request rejection (every unit declined or nobody
 * answered); the backend never persists it as a request state, it only travels
 * as the per-unit push discriminant.
 *
 * <p>{@code CANCELADA} is the requester's own withdrawal while the request is
 * still PENDIENTE. It is NOT {@code RECHAZADA}: a rejection is a fleet outcome,
 * a cancellation is the citizen's decision before any unit is assigned. Once a
 * unit accepted, the ambulance is on its way and the request can no longer be
 * cancelled (409). It is declared as a contract delta in
 * {@code docs/diseno/back-cancelar-solicitud.md} because the OpenAPI enum does
 * not carry it yet.
 */
public enum EstadoSolicitud {
    PENDIENTE,
    ASIGNADA,
    CONFIRMADA,
    TOMADA,
    RECHAZADA,
    TIMEOUT,
    CANCELADA
}
