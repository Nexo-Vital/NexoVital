package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Outbound port for the request aggregate. */
public interface SolicitudRepository {

    SolicitudAmbulancia guardar(SolicitudAmbulancia solicitud);

    Optional<SolicitudAmbulancia> buscarPorId(UUID id);

    /**
     * CAS (compare-and-swap) of the C2 broadcast: updates the request with a
     * single SQL statement only if it is still in {@code estadoEsperado}, and
     * assigns the ambulance. Returns affected rows: 1 = this caller won the
     * transition, 0 = another one won first (lost race or state already moved).
     */
    int transicionAtomicaAsignar(UUID idSolicitud, UUID ambulanciaId,
                                 EstadoSolicitud estadoEsperado, EstadoSolicitud nuevoEstado);

    int transicionAtomicaEstado(UUID idSolicitud,
                                EstadoSolicitud estadoEsperado, EstadoSolicitud nuevoEstado);

    /**
     * Atomic, idempotent arrival milestone: writes {@code llegadaEn} only if no
     * arrival was recorded yet. Returns 1 when this call recorded it (the caller
     * emits the post-commit event) and 0 when another call already did (the
     * caller treats it as a no-op).
     */
    int transicionAtomicaLlegada(UUID idSolicitud, Instant llegadaEn);

    /**
     * Closes the request in the same operation that releases the unit: a single
     * UPDATE conditioned on the request still being in service ({@code
     * ASIGNADA} or {@code CONFIRMADA}) that moves it to the terminal
     * {@code TOMADA}. Returns 1 when this caller closed it, 0 when another one
     * did first.
     */
    int transicionAtomicaFinalizar(UUID idSolicitud, Collection<EstadoSolicitud> estadosEsperados,
                                   EstadoSolicitud nuevoEstado);

    /**
     * PENDING requests whose accept window already elapsed, oldest first and
     * bounded so the expiry transaction stays small.
     */
    List<SolicitudAmbulancia> listarPendientesVencidas(Instant ahora);

    /**
     * Services ASSIGNED to {@code ambulanciaId}, newest first (request creation
     * instant descending). Only requests whose assigned unit is that one
     * qualify: a request that was merely broadcast (PENDIENTE) or closed before
     * any assignment (TIMEOUT/CANCELADA) has no assigned unit and is never part
     * of the history.
     */
    List<SolicitudAmbulancia> listarPorAmbulanciaAsignada(UUID ambulanciaId);

    /**
     * CAS de expiración: UNA sola UPDATE que cierra la solicitud solo si sigue
     * PENDIENTE Y su {@code timeoutEn} ya pasó. Devuelve filas afectadas: 1 =
     * este llamador la expiró, 0 = otro la atendió o expiró primero. Es
     * idempotente y no compite con el accept: ambos son UPDATE condicionados.
     */
    int transicionAtomicaExpirar(UUID idSolicitud, EstadoSolicitud estadoEsperado,
                                 EstadoSolicitud nuevoEstado, Instant ahora);

    /**
     * Open requests a unit can still answer (EP-04.F2.US1, D6): PENDING, with
     * the accept window still open at {@code ahora}, and with
     * {@code ambulanciaId} among the notified units. Oldest first. A request the
     * unit was never notified of does not qualify, whatever its state.
     */
    List<SolicitudAmbulancia> listarPendientesNotificadasA(UUID ambulanciaId, Instant ahora);
}
