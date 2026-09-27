package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.mapa.domain.port.out.AlertasEscasezQueryPort;
import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarAlertasEscasezUseCase;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Satisfies {@link AlertasEscasezQueryPort} by delegating to the public input
 * port of {@code recursos}. It is the only point of {@code mapa} that knows the
 * alerts of {@code recursos}: the data boundary holds because there is no
 * access to its table, only to its public port (ADR-0003).
 *
 * <p>Mirror of {@code CentroMapaQueryAdapter}, which delegates to
 * {@code usuarios}.
 */
@Component
public class AlertasEscasezQueryAdapter implements AlertasEscasezQueryPort {

    private final ConsultarAlertasEscasezUseCase consultarAlertasEscasezUseCase;

    public AlertasEscasezQueryAdapter(ConsultarAlertasEscasezUseCase consultarAlertasEscasezUseCase) {
        this.consultarAlertasEscasezUseCase = consultarAlertasEscasezUseCase;
    }

    @Override
    public List<AlertaEscasezActiva> listarActivas() {
        return consultarAlertasEscasezUseCase.listarActivas();
    }
}
