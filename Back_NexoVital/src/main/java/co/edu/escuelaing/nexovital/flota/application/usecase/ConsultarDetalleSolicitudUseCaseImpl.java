package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudAjenaException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoEncontradaException;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarDetalleSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/**
 * Authoritative detail of a request (EP-04.F2.US3).
 *
 * <p>Authorization is <b>by identity, not by role</b>: an authenticated caller
 * may read the request only when they are
 * <ul>
 *   <li>the requester ({@code solicitanteId}), or</li>
 *   <li>the driver of the assigned unit ({@code ambulanciaAsignadaId}), or</li>
 *   <li>the driver of a notified unit ({@code ambulanciasNotificadas}).</li>
 * </ul>
 * Anyone else gets {@link SolicitudAjenaException} (403), so the request never
 * leaks to another authenticated user. The driver's own unit is resolved
 * server-side from their user id (D-F6: one unit per driver); the client never
 * names it, exactly as {@code GET /flota/ambulancias/mia} does.
 */
@Service
public class ConsultarDetalleSolicitudUseCaseImpl implements ConsultarDetalleSolicitudUseCase {

    private final SolicitudRepository solicitudRepository;
    private final AmbulanciaRepository ambulanciaRepository;

    public ConsultarDetalleSolicitudUseCaseImpl(SolicitudRepository solicitudRepository,
                                                AmbulanciaRepository ambulanciaRepository) {
        this.solicitudRepository = solicitudRepository;
        this.ambulanciaRepository = ambulanciaRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public SolicitudAmbulancia consultar(UUID solicitudId, UUID usuarioId) {
        SolicitudAmbulancia solicitud = solicitudRepository.buscarPorId(solicitudId)
                .orElseThrow(() -> new SolicitudNoEncontradaException(solicitudId));

        if (!puedeLeer(solicitud, usuarioId)) {
            throw new SolicitudAjenaException(solicitudId, usuarioId);
        }
        return solicitud;
    }

    /** The private-read rule of the story: requester or an involved driver. */
    private boolean puedeLeer(SolicitudAmbulancia solicitud, UUID usuarioId) {
        if (Objects.equals(solicitud.getSolicitanteId(), usuarioId)) {
            return true;
        }
        // A driver with no unit resolves to empty and is neither the assigned nor
        // a notified driver, so they fall through to the refusal.
        return ambulanciaRepository.buscarPorConductor(usuarioId)
                .map(Ambulancia::getId)
                .map(unidadId -> unidadId.equals(solicitud.getAmbulanciaAsignadaId())
                        || solicitud.getAmbulanciasNotificadas().contains(unidadId))
                .orElse(false);
    }
}
