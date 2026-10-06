package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarAlertasEscasezUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Builds the active alerts read-model straight from the inventory: one alert
 * per resource whose stock is below what its center declared it needs.
 *
 * <p>Nothing is stored. The alert is a function of the current stock, so it is
 * computed at read time: it appears when a center declares a need, shrinks with
 * every donation and disappears when the need is covered. The most missing
 * resource comes first.
 */
@Service
public class ConsultarAlertasEscasezUseCaseImpl implements ConsultarAlertasEscasezUseCase {

    private final InventarioRepository inventarioRepository;

    public ConsultarAlertasEscasezUseCaseImpl(InventarioRepository inventarioRepository) {
        this.inventarioRepository = inventarioRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<AlertaEscasezActiva> listarActivas() {
        return inventarioRepository.listarTodos().stream()
                .map(AlertaEscasezActiva::de)
                .flatMap(Optional::stream)
                .sorted(Comparator.comparingInt(AlertaEscasezActiva::faltante).reversed()
                        .thenComparing(AlertaEscasezActiva::nombre))
                .toList();
    }
}
