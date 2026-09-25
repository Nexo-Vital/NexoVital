package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarSemaforoCentrosUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Calcula el semáforo de cada centro a partir de su inventario: un centro es tan
 * sano como su item más escaso, así que se queda el PEOR nivel
 * ({@link Semaforo#masGrave}). Un centro sin inventario no entra al mapa, de
 * modo que el consumidor distingue "no declarado" de cualquier nivel.
 */
@Service
public class ConsultarSemaforoCentrosUseCaseImpl implements ConsultarSemaforoCentrosUseCase {

    private final InventarioRepository inventarioRepository;

    public ConsultarSemaforoCentrosUseCaseImpl(InventarioRepository inventarioRepository) {
        this.inventarioRepository = inventarioRepository;
    }

    @Override
    public Map<UUID, Semaforo> consultar() {
        Map<UUID, Semaforo> porCentro = new HashMap<>();
        for (ItemInventario item : inventarioRepository.listarTodos()) {
            porCentro.merge(item.getCentroAcopioId(), item.semaforo(), Semaforo::masGrave);
        }
        return Map.copyOf(porCentro);
    }
}
