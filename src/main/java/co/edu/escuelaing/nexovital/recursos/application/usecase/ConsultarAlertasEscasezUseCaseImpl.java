package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;
import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarAlertasEscasezUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.AlertaEscasezRepository;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Builds the active alerts read-model: every stored alert joined with the stock
 * its item holds now.
 *
 * <p>An alert is published only when it is still active (FA-3) and its item
 * still exists: an alert whose item was removed cannot be covered, so it is not
 * shown. The {@code faltante} is computed here, at read time, from the current
 * stock — never read from a stored number.
 */
@Service
public class ConsultarAlertasEscasezUseCaseImpl implements ConsultarAlertasEscasezUseCase {

    private final AlertaEscasezRepository alertaEscasezRepository;
    private final InventarioRepository inventarioRepository;

    public ConsultarAlertasEscasezUseCaseImpl(AlertaEscasezRepository alertaEscasezRepository,
                                              InventarioRepository inventarioRepository) {
        this.alertaEscasezRepository = alertaEscasezRepository;
        this.inventarioRepository = inventarioRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<AlertaEscasezActiva> listarActivas() {
        Map<UUID, Map<UUID, Integer>> stockPorCentro = new HashMap<>();
        for (ItemInventario item : inventarioRepository.listarTodos()) {
            stockPorCentro
                    .computeIfAbsent(item.getCentroAcopioId(), centro -> new HashMap<>())
                    .put(item.getId(), item.getDisponible());
        }

        List<AlertaEscasezActiva> activas = new ArrayList<>();
        for (AlertaEscasez alerta : alertaEscasezRepository.listarTodas()) {
            Integer disponible = stockPorCentro
                    .getOrDefault(alerta.getCentroAcopioId(), Map.of())
                    .get(alerta.getItemId());
            if (disponible == null || !alerta.estaActiva(disponible)) {
                continue;
            }
            activas.add(new AlertaEscasezActiva(
                    alerta.getCentroAcopioId(),
                    alerta.getItemId(),
                    alerta.getNombre(),
                    alerta.getCantidadSolicitada(),
                    disponible,
                    alerta.faltante(disponible),
                    alerta.getCreadaEn()));
        }
        return activas;
    }
}
