package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ListarSolicitudesDeMiAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Read-only service history of the driver's own unit (EP-04, task CON-3). */
@Service
public class ListarSolicitudesDeMiAmbulanciaUseCaseImpl implements ListarSolicitudesDeMiAmbulanciaUseCase {

    private final SolicitudRepository solicitudRepository;

    public ListarSolicitudesDeMiAmbulanciaUseCaseImpl(SolicitudRepository solicitudRepository) {
        this.solicitudRepository = solicitudRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<SolicitudAmbulancia> listar(UUID ambulanciaId) {
        Objects.requireNonNull(ambulanciaId, "ambulanciaId is required");
        // The out port already filters by assigned unit and orders newest first;
        // the explicit predicate and re-sort keep the invariant by construction,
        // so a widened query can neither leak a broadcast request nor break the
        // order the contract fixes.
        return solicitudRepository.listarPorAmbulanciaAsignada(ambulanciaId).stream()
                .filter(solicitud -> ambulanciaId.equals(solicitud.getAmbulanciaAsignadaId()))
                .sorted(Comparator.comparing(SolicitudAmbulancia::getSolicitadaEn).reversed())
                .toList();
    }
}
