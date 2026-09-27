package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

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
}
