package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
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
     * PENDING requests whose accept window already elapsed, oldest first and
     * bounded so the expiry transaction stays small.
     */
    List<SolicitudAmbulancia> listarPendientesVencidas(Instant ahora);

    /**
     * CAS de expiración: UNA sola UPDATE que cierra la solicitud solo si sigue
     * PENDIENTE Y su {@code timeoutEn} ya pasó. Devuelve filas afectadas: 1 =
     * este llamador la expiró, 0 = otro la atendió o expiró primero. Es
     * idempotente y no compite con el accept: ambos son UPDATE condicionados.
     */
    int transicionAtomicaExpirar(UUID idSolicitud, EstadoSolicitud estadoEsperado,
                                 EstadoSolicitud nuevoEstado, Instant ahora);
}
