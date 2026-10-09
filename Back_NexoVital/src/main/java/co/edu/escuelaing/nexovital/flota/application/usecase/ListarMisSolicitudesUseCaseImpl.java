package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ListarMisSolicitudesUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Lists the requester's active (EP-04.F2.US9) or attended (EP-04.F2.US11) requests. */
@Service
public class ListarMisSolicitudesUseCaseImpl implements ListarMisSolicitudesUseCase {

    private static final List<EstadoSolicitud> ESTADOS_ACTIVOS =
            List.of(EstadoSolicitud.PENDIENTE, EstadoSolicitud.ASIGNADA, EstadoSolicitud.CONFIRMADA);

    private static final List<EstadoSolicitud> ESTADOS_ATENDIDOS = List.of(EstadoSolicitud.TOMADA);

    private final SolicitudRepository solicitudRepository;

    public ListarMisSolicitudesUseCaseImpl(SolicitudRepository solicitudRepository) {
        this.solicitudRepository = solicitudRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<SolicitudAmbulancia> listarActivas(UUID solicitanteId) {
        Objects.requireNonNull(solicitanteId, "solicitanteId is required");
        return solicitudRepository.listarDelSolicitante(solicitanteId, ESTADOS_ACTIVOS);
    }

    @Override
    @Transactional(readOnly = true)
    public List<SolicitudAmbulancia> listarAtendidas(UUID solicitanteId) {
        Objects.requireNonNull(solicitanteId, "solicitanteId is required");
        return solicitudRepository.listarDelSolicitante(solicitanteId, ESTADOS_ATENDIDOS);
    }
}
