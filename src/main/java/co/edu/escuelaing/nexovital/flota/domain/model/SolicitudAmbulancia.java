package co.edu.escuelaing.nexovital.flota.domain.model;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Ambulance request of the C2 broadcast. Immutable: every state transition
 * validates its source state and returns a copy, or throws
 * {@link IllegalStateException} when the transition is not allowed.
 *
 * <p>Valid transitions: PENDIENTE → ASIGNADA (first accept wins, CAS),
 * PENDIENTE → TIMEOUT, ASIGNADA → CONFIRMADA, ASIGNADA → TOMADA.
 *
 * <p>A per-unit decline is NOT a state transition here: it leaves the request
 * {@code PENDIENTE} so the other notified units can still accept it (AC4). The
 * {@code RECHAZADA} state is reserved for a future whole-request cancellation.
 */
public final class SolicitudAmbulancia {

    private final UUID id;
    private final UUID emergenciaId;
    private final EstadoSolicitud estado;
    private final UUID centroAyudaId;
    private final String zonaId;
    private final Instant solicitadaEn;
    private final Instant timeoutEn;
    private final List<UUID> ambulanciasNotificadas;
    private final UUID ambulanciaAsignadaId;
    private final long version;

    private SolicitudAmbulancia(UUID id, UUID emergenciaId, EstadoSolicitud estado, UUID centroAyudaId,
                                String zonaId, Instant solicitadaEn, Instant timeoutEn,
                                List<UUID> ambulanciasNotificadas, UUID ambulanciaAsignadaId, long version) {
        this.id = Objects.requireNonNull(id, "id is required");
        this.emergenciaId = Objects.requireNonNull(emergenciaId, "emergenciaId is required");
        this.estado = Objects.requireNonNull(estado, "estado is required");
        this.centroAyudaId = Objects.requireNonNull(centroAyudaId, "centroAyudaId is required");
        this.zonaId = Objects.requireNonNull(zonaId, "zonaId is required");
        this.solicitadaEn = Objects.requireNonNull(solicitadaEn, "solicitadaEn is required");
        this.timeoutEn = Objects.requireNonNull(timeoutEn, "timeoutEn is required");
        this.ambulanciasNotificadas = ambulanciasNotificadas == null
                ? List.of()
                : List.copyOf(ambulanciasNotificadas);
        this.ambulanciaAsignadaId = ambulanciaAsignadaId;
        this.version = version;
    }

    public static SolicitudAmbulancia solicitar(UUID id, UUID emergenciaId, UUID centroAyudaId, String zonaId,
                                                Instant solicitadaEn, Instant timeoutEn,
                                                List<UUID> ambulanciasNotificadas) {
        return new SolicitudAmbulancia(id, emergenciaId, EstadoSolicitud.PENDIENTE, centroAyudaId, zonaId,
                solicitadaEn, timeoutEn, ambulanciasNotificadas, null, 0);
    }

    /**
     * Rebuilds the aggregate from persistence (out adapter). It does not
     * validate transitions: the state arrives exactly as it was stored.
     */
    public static SolicitudAmbulancia restaurar(UUID id, UUID emergenciaId, EstadoSolicitud estado,
                                                UUID centroAyudaId, String zonaId, Instant solicitadaEn,
                                                Instant timeoutEn, List<UUID> ambulanciasNotificadas,
                                                UUID ambulanciaAsignadaId, long version) {
        return new SolicitudAmbulancia(id, emergenciaId, estado, centroAyudaId, zonaId,
                solicitadaEn, timeoutEn, ambulanciasNotificadas, ambulanciaAsignadaId, version);
    }

    private static SolicitudAmbulancia conEstado(SolicitudAmbulancia actual, EstadoSolicitud nuevo,
                                                 UUID ambulanciaAsignadaId) {
        return new SolicitudAmbulancia(actual.id, actual.emergenciaId, nuevo, actual.centroAyudaId,
                actual.zonaId, actual.solicitadaEn, actual.timeoutEn,
                actual.ambulanciasNotificadas, ambulanciaAsignadaId, actual.version + 1);
    }

    private static void requiereTransicion(SolicitudAmbulancia solicitud, EstadoSolicitud esperado, String accion) {
        if (solicitud.estado != esperado) {
            throw new IllegalStateException("Request " + solicitud.id + " in state " + solicitud.estado
                    + " does not allow " + accion + " (requires " + esperado + ")");
        }
    }

    /** PENDIENTE → ASIGNADA. The caller that wins the CAS is the one that calls this. */
    public SolicitudAmbulancia aceptar(UUID ambulanciaId) {
        requiereTransicion(this, EstadoSolicitud.PENDIENTE, "assignment");
        return conEstado(this, EstadoSolicitud.ASIGNADA,
                Objects.requireNonNull(ambulanciaId, "ambulanciaId is required"));
    }

    /** ASIGNADA → TOMADA. */
    public SolicitudAmbulancia marcarTomada() {
        requiereTransicion(this, EstadoSolicitud.ASIGNADA, "mark as taken");
        return conEstado(this, EstadoSolicitud.TOMADA, ambulanciaAsignadaId);
    }

    /** PENDIENTE → TIMEOUT. Raised when no unit accepted within the window. */
    public SolicitudAmbulancia expiro() {
        requiereTransicion(this, EstadoSolicitud.PENDIENTE, "expire");
        return conEstado(this, EstadoSolicitud.TIMEOUT, null);
    }

    /** ASIGNADA → CONFIRMADA, decided by the help center. */
    public SolicitudAmbulancia confirmar() {
        requiereTransicion(this, EstadoSolicitud.ASIGNADA, "confirmation");
        return conEstado(this, EstadoSolicitud.CONFIRMADA, ambulanciaAsignadaId);
    }

    public boolean estaVencida() {
        return estado == EstadoSolicitud.PENDIENTE && timeoutEn.isBefore(Instant.now());
    }

    /** @return true when this unit was part of the broadcast (AC1 / L3 filter). */
    public boolean fueNotificada(UUID ambulanciaId) {
        return ambulanciasNotificadas.contains(ambulanciaId);
    }

    public UUID getId() {
        return id;
    }

    public UUID getEmergenciaId() {
        return emergenciaId;
    }

    public EstadoSolicitud getEstado() {
        return estado;
    }

    public UUID getCentroAyudaId() {
        return centroAyudaId;
    }

    public String getZonaId() {
        return zonaId;
    }

    public Instant getSolicitadaEn() {
        return solicitadaEn;
    }

    public Instant getTimeoutEn() {
        return timeoutEn;
    }

    public List<UUID> getAmbulanciasNotificadas() {
        return ambulanciasNotificadas;
    }

    public UUID getAmbulanciaAsignadaId() {
        return ambulanciaAsignadaId;
    }

    public long getVersion() {
        return version;
    }
}
