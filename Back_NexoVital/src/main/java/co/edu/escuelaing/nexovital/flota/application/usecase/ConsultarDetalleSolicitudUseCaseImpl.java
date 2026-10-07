package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoNotificadaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarDetalleSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Read-only detail of a request for a driver (EP-04.F2.US3).
 *
 * <p>The unit is resolved from the authenticated driver, never from the client,
 * exactly as {@code /ambulancias/mia} does: a driver cannot read a request by
 * claiming another unit.
 *
 * <p>The order of the checks is deliberate: an unknown id answers "not found"
 * first, and only an existing request can answer "not yours". The team chose
 * 403 over 404 for a request that exists but did not reach the unit.
 */
@Service
public class ConsultarDetalleSolicitudUseCaseImpl implements ConsultarDetalleSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final FlotaQueryPort flotaQueryPort;

    public ConsultarDetalleSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                                FlotaQueryPort flotaQueryPort) {
        this.solicitudRepository = solicitudRepository;
        this.flotaQueryPort = flotaQueryPort;
    }

    @Override
    @Transactional(readOnly = true)
    public SolicitudAmbulancia consultar(UUID solicitudId, UUID conductorId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        UUID unidadId = flotaQueryPort.buscarPorConductor(conductorId)
                .map(Ambulancia::getId)
                .orElseThrow(() -> new SolicitudNoNotificadaException(solicitudId, conductorId));

        boolean notificada = solicitud.getAmbulanciasNotificadas() != null
                && solicitud.getAmbulanciasNotificadas().contains(unidadId);
        boolean asignada = unidadId.equals(solicitud.getAmbulanciaAsignadaId());
        if (!notificada && !asignada) {
            throw new SolicitudNoNotificadaException(solicitudId, conductorId);
        }
        return solicitud;
    }
}
