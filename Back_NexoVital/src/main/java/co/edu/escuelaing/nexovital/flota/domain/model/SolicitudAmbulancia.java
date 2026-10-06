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
 * PENDIENTE → TIMEOUT, PENDIENTE → CANCELADA (the requester withdraws before a
 * winner exists), ASIGNADA → CONFIRMADA, ASIGNADA → TOMADA,
 * ASIGNADA/CONFIRMADA → TOMADA (finish/release).
 *
 * <p>A per-unit decline is NOT a state transition here: it leaves the request
 * {@code PENDIENTE} so the other notified units can still accept it (AC4). The
 * {@code RECHAZADA} state is the contract's whole-request rejection (every unit
 * declined or nobody answered) and is never persisted by this aggregate.
 * {@code CANCELADA} is a different outcome: the requester's own withdrawal while
 * the request is PENDIENTE.
 *
 * <p>Arrival is also NOT a lifecycle state: the winning unit declares it on an
 * already-ASIGNADA request and the milestone is recorded in {@code llegadaEn}.
 * Reusing the existing state enum (the request stays ASIGNADA) keeps a single
 * state machine; arrival is a mission milestone, not a parallel state (see
 * {@code llegadaEn} in the front domain). The milestone is monotone: {@code
 * llegar} refuses to move it backwards and the use case treats a repeat as a
 * no-op.
 *
 * <p><b>Pickup location is the only mandatory geographic field.</b> A citizen
 * request no longer depends on an affected zone: it carries the point where the
 * unit must pick the patient up. {@code emergenciaId}, {@code centroAyudaId} and
 * {@code zonaId} become optional context — an emergency was a prerequisite
 * before, now it is only a reference when the report was anchored to one, and
 * the zone is a map warning that never gates the dispatch.
 */
public final class SolicitudAmbulancia {

    private final UUID id;
    /**
     * Pickup point: where the unit must go. It is the request's own location,
     * independent from any emergency, and the only required geographic field.
     */
    private final double lat;
    private final double lng;
    /** Optional reference to the emergency the request may be anchored to. */
    private final UUID emergenciaId;
    private final EstadoSolicitud estado;
    /** Optional aid-center reference; a standalone citizen request has none. */
    private final UUID centroAyudaId;
    /** Optional zone context; the zone is a map warning, never a dispatch key. */
    private final String zonaId;
    private final Instant solicitadaEn;
    private final Instant timeoutEn;
    /**
     * Id of the user who raised the request. It is the citizen's own user id and
     * the target of their private lifecycle queue, so they can watch their own
     * request instead of being left without feedback.
     */
    private final UUID solicitanteId;
    private final List<UUID> ambulanciasNotificadas;
    private final UUID ambulanciaAsignadaId;
    /**
     * Instant the winning unit declared its arrival at the scene, or null while
     * it has not. It is a mission milestone, not a lifecycle state: the request
     * remains ASIGNADA, so no parallel state machine is introduced.
     */
    private final Instant llegadaEn;
    private final long version;
    /**
     * How many retries the request has already spent (EP-04.F2.US4). It starts at
     * 0 and grows by one each time the accept window closes with no winner while
     * there are still available units. It is pure state, not a framework
     * concern: the sweep reads it to decide retry vs. final {@code TIMEOUT}.
     */
    private final int reintentos;

    private SolicitudAmbulancia(UUID id, double lat, double lng, UUID emergenciaId, EstadoSolicitud estado,
                                UUID centroAyudaId, String zonaId, Instant solicitadaEn, Instant timeoutEn,
                                UUID solicitanteId, List<UUID> ambulanciasNotificadas,
                                UUID ambulanciaAsignadaId, Instant llegadaEn, long version, int reintentos) {
        this.id = Objects.requireNonNull(id, "id is required");
        this.lat = lat;
        this.lng = lng;
        // Optional by design: a standalone request has no emergency, center or zone.
        this.emergenciaId = emergenciaId;
        this.estado = Objects.requireNonNull(estado, "estado is required");
        this.centroAyudaId = centroAyudaId;
        this.zonaId = zonaId;
        this.solicitadaEn = Objects.requireNonNull(solicitadaEn, "solicitadaEn is required");
        this.timeoutEn = Objects.requireNonNull(timeoutEn, "timeoutEn is required");
        // Not required here: `restaurar` must tolerate rows persisted before the
        // requester was tracked. New requests enforce it in `solicitar`.
        this.solicitanteId = solicitanteId;
        this.ambulanciasNotificadas = ambulanciasNotificadas == null
                ? List.of()
                : List.copyOf(ambulanciasNotificadas);
        this.ambulanciaAsignadaId = ambulanciaAsignadaId;
        this.llegadaEn = llegadaEn;
        this.version = version;
        // Defensive floor: a request can never carry a negative retry count.
        this.reintentos = Math.max(0, reintentos);
    }

    /**
     * Creates a PENDIENTE request. The pickup location is mandatory and must be
     * a finite coordinate; the emergency, center and zone are optional context.
     *
     * @throws IllegalArgumentException if the pickup point is not a finite pair
     */
    public static SolicitudAmbulancia solicitar(UUID id, double lat, double lng,
                                                UUID emergenciaId, UUID centroAyudaId, String zonaId,
                                                Instant solicitadaEn, Instant timeoutEn, UUID solicitanteId,
                                                List<UUID> ambulanciasNotificadas) {
        if (!Double.isFinite(lat) || !Double.isFinite(lng)) {
            throw new IllegalArgumentException("La ubicación del pedido debe ser un punto válido.");
        }
        Objects.requireNonNull(solicitanteId, "solicitanteId is required");
        return new SolicitudAmbulancia(id, lat, lng, emergenciaId, EstadoSolicitud.PENDIENTE, centroAyudaId,
                zonaId, solicitadaEn, timeoutEn, solicitanteId, ambulanciasNotificadas, null, null, 0, 0);
    }

    /**
     * Rebuilds the aggregate from persistence (out adapter). It does not
     * validate transitions: the state arrives exactly as it was stored.
     */
    public static SolicitudAmbulancia restaurar(UUID id, double lat, double lng, UUID emergenciaId,
                                                EstadoSolicitud estado, UUID centroAyudaId, String zonaId,
                                                Instant solicitadaEn, Instant timeoutEn, UUID solicitanteId,
                                                List<UUID> ambulanciasNotificadas,
                                                UUID ambulanciaAsignadaId, Instant llegadaEn, long version,
                                                int reintentos) {
        return new SolicitudAmbulancia(id, lat, lng, emergenciaId, estado, centroAyudaId, zonaId,
                solicitadaEn, timeoutEn, solicitanteId, ambulanciasNotificadas, ambulanciaAsignadaId,
                llegadaEn, version, reintentos);
    }

    private static SolicitudAmbulancia conEstado(SolicitudAmbulancia actual, EstadoSolicitud nuevo,
                                                 UUID ambulanciaAsignadaId) {
        return new SolicitudAmbulancia(actual.id, actual.lat, actual.lng, actual.emergenciaId, nuevo,
                actual.centroAyudaId, actual.zonaId, actual.solicitadaEn, actual.timeoutEn, actual.solicitanteId,
                actual.ambulanciasNotificadas, ambulanciaAsignadaId, actual.llegadaEn, actual.version + 1,
                actual.reintentos);
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

    /**
     * PENDIENTE → CANCELADA. The requester withdraws the request while nobody
     * accepted it. Once a unit is assigned the ambulance is on its way and the
     * withdrawal is refused by the caller (409), so this is only valid on a
     * still-open PENDIENTE request.
     *
     * @throws IllegalStateException if the request already moved past PENDIENTE
     */
    public SolicitudAmbulancia cancelar() {
        requiereTransicion(this, EstadoSolicitud.PENDIENTE, "cancellation");
        return conEstado(this, EstadoSolicitud.CANCELADA, null);
    }

    /** ASIGNADA → CONFIRMADA, decided by the help center. */
    public SolicitudAmbulancia confirmar() {
        requiereTransicion(this, EstadoSolicitud.ASIGNADA, "confirmation");
        return conEstado(this, EstadoSolicitud.CONFIRMADA, ambulanciaAsignadaId);
    }

    /**
     * Closes the attended request: ASIGNADA or CONFIRMADA → TOMADA. Called by
     * the finish operation, which releases the unit in the same atomic step
     * (EP-04.F2.US6/US11). {@code TOMADA} is the contract's terminal forward
     * state ("the service was carried out"), so the request stops being active
     * without inventing new lifecycle vocabulary.
     *
     * @throws IllegalStateException if the request is not in service
     */
    public SolicitudAmbulancia finalizar() {
        if (estado != EstadoSolicitud.ASIGNADA && estado != EstadoSolicitud.CONFIRMADA) {
            throw new IllegalStateException("Request " + id + " in state " + estado
                    + " does not allow finish (requires ASIGNADA or CONFIRMADA)");
        }
        return conEstado(this, EstadoSolicitud.TOMADA, ambulanciaAsignadaId);
    }

    /**
     * Records the winning unit's arrival at the scene. It is a milestone on an
     * assigned request, NOT a lifecycle state: the estado is unchanged, so no
     * parallel state machine exists. It only applies to an ASIGNADA request; a
     * request that has not been assigned cannot have an arrival.
     *
     * @param llegadaEn instant the unit declared its arrival
     * @throws IllegalStateException if the request is not ASIGNADA
     */
    public SolicitudAmbulancia llegar(Instant llegadaEn) {
        requiereTransicion(this, EstadoSolicitud.ASIGNADA, "arrival");
        return new SolicitudAmbulancia(id, lat, lng, emergenciaId, estado, centroAyudaId, zonaId,
                solicitadaEn, timeoutEn, solicitanteId, ambulanciasNotificadas, ambulanciaAsignadaId,
                Objects.requireNonNull(llegadaEn, "llegadaEn is required"), version + 1, reintentos);
    }

    /**
     * Repositions the accept window of a still-open PENDIENTE request and
     * replaces the notified set with the units available RIGHT NOW
     * (EP-04.F2.US4).
     *
     * <p><b>Why re-notify the whole available set.</b> The repo's broadcast has
     * no zone/radio filter by design ({@code SolicitarAmbulanciaUseCaseImpl}
     * notifies EVERY available unit), so the story's "widen the search radius" is
     * implemented as re-emitting to the current available units — the widest
     * radius the system already knows. A unit that connected after the original
     * emission (the real repro: the driver reopens the console) is therefore
     * included.
     *
     * <p>The estado does NOT change: the request stays PENDIENTE so a unit that
     * accepts during the new window still wins the same CAS. Only the window and
     * the notified set move, and the retry counter grows by one.
     *
     * @param nuevoTimeoutEn new accept deadline, strictly after the retry instant
     * @param nuevasNotificadas current available units to re-notify
     * @throws IllegalStateException if the request is not PENDIENTE
     */
    public SolicitudAmbulancia reintentar(Instant nuevoTimeoutEn, List<UUID> nuevasNotificadas) {
        requiereTransicion(this, EstadoSolicitud.PENDIENTE, "retry");
        return new SolicitudAmbulancia(id, lat, lng, emergenciaId, estado, centroAyudaId, zonaId,
                solicitadaEn, Objects.requireNonNull(nuevoTimeoutEn, "nuevoTimeoutEn is required"),
                solicitanteId,
                nuevasNotificadas == null ? List.of() : nuevasNotificadas,
                ambulanciaAsignadaId, llegadaEn, version + 1, reintentos + 1);
    }

    public boolean estaVencida() {
        return estaVencida(Instant.now());
    }

    /**
     * Expiry is about the request as a whole: it only holds while the request is
     * still PENDIENTE (no unit accepted within the notification window). Once a
     * winner is assigned, the window no longer applies. The instant is injected
     * so the scheduler can evaluate it against the application clock.
     *
     * @param ahora instant used as "now"
     */
    public boolean estaVencida(Instant ahora) {
        return estado == EstadoSolicitud.PENDIENTE && timeoutEn.isBefore(ahora);
    }

    /** @return true when this unit was part of the broadcast (AC1 / L3 filter). */
    public boolean fueNotificada(UUID ambulanciaId) {
        return ambulanciasNotificadas.contains(ambulanciaId);
    }

    public UUID getId() {
        return id;
    }

    /** Pickup point latitude: where the unit must go. */
    public double getLat() {
        return lat;
    }

    /** Pickup point longitude: where the unit must go. */
    public double getLng() {
        return lng;
    }

    /** Optional emergency reference, or null for a standalone request. */
    public UUID getEmergenciaId() {
        return emergenciaId;
    }

    public EstadoSolicitud getEstado() {
        return estado;
    }

    /** Optional aid-center reference, or null for a standalone request. */
    public UUID getCentroAyudaId() {
        return centroAyudaId;
    }

    /** Optional zone context, or null when the request declares none. */
    public String getZonaId() {
        return zonaId;
    }

    public Instant getSolicitadaEn() {
        return solicitadaEn;
    }

    public Instant getTimeoutEn() {
        return timeoutEn;
    }

    public UUID getSolicitanteId() {
        return solicitanteId;
    }

    public List<UUID> getAmbulanciasNotificadas() {
        return ambulanciasNotificadas;
    }

    public UUID getAmbulanciaAsignadaId() {
        return ambulanciaAsignadaId;
    }

    /** Arrival milestone instant, or null while the unit has not arrived. */
    public Instant getLlegadaEn() {
        return llegadaEn;
    }

    public long getVersion() {
        return version;
    }

    /** Retries already spent on this request (0 for a freshly created one). */
    public int getReintentos() {
        return reintentos;
    }
}
