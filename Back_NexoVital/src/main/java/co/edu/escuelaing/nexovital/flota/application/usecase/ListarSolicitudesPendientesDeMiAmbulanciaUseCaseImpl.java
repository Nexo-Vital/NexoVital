package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ListarSolicitudesPendientesDeMiAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Read-only list of the open requests a driver can still answer (EP-04.F2.US1,
 * D6).
 *
 * <p>The clock is the same one the expiry sweep uses, so "still open" means the
 * same thing in both places: a request leaves this list at the instant the
 * sweep would close it.
 *
 * <p>A unit that is disconnected or not available gets an empty list: a
 * disconnected driver does not see pending requests, and a busy unit cannot
 * take another one. The accept enforces both conditions again in its own
 * UPDATE, so this read is a view and never the guarantee.
 */
@Service
public class ListarSolicitudesPendientesDeMiAmbulanciaUseCaseImpl
        implements ListarSolicitudesPendientesDeMiAmbulanciaUseCase {

    private final FlotaQueryPort flotaQueryPort;
    private final SolicitudRepository solicitudRepository;
    private final Clock clock;

    public ListarSolicitudesPendientesDeMiAmbulanciaUseCaseImpl(FlotaQueryPort flotaQueryPort,
                                                                SolicitudRepository solicitudRepository,
                                                                Clock clock) {
        this.flotaQueryPort = flotaQueryPort;
        this.solicitudRepository = solicitudRepository;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<List<SolicitudAmbulancia>> listar(UUID conductorId) {
        Optional<Ambulancia> propia = flotaQueryPort.buscarPorConductor(conductorId);
        if (propia.isEmpty()) {
            return Optional.empty();
        }
        Ambulancia unidad = propia.get();
        if (!unidad.isConectada() || unidad.getEstado() != EstadoAmbulancia.DISPONIBLE) {
            return Optional.of(List.of());
        }
        return Optional.of(
                solicitudRepository.listarPendientesNotificadasA(unidad.getId(), Instant.now(clock)));
    }
}
