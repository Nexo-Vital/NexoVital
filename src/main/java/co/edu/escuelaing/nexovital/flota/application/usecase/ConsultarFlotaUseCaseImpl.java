package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ConsultarFlotaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.springframework.stereotype.Service;

import java.util.List;

/** Read-only fleet query with position and state (AC5). */
@Service
public class ConsultarFlotaUseCaseImpl implements ConsultarFlotaUseCase {

    private final FlotaQueryPort flotaQueryPort;

    public ConsultarFlotaUseCaseImpl(FlotaQueryPort flotaQueryPort) {
        this.flotaQueryPort = flotaQueryPort;
    }

    @Override
    public List<Ambulancia> consultarFlota() {
        return flotaQueryPort.consultarFlota();
    }
}
