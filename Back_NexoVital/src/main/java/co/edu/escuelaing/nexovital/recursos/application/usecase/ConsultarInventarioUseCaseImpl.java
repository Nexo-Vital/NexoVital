package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarInventarioUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroAcopioQueryPort;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * Consulta el inventario de un centro. La existencia se verifica contra el
 * puerto hacia {@code usuarios} (nunca contra su tabla, ADR-0003) y el módulo
 * decide el 404 lanzando {@link CentroAcopioNoEncontradoException}; la lógica
 * de lectura vive en el adaptador de persistencia y aquí solo se orquesta.
 */
@Service
public class ConsultarInventarioUseCaseImpl implements ConsultarInventarioUseCase {

    private final InventarioRepository inventarioRepository;
    private final CentroAcopioQueryPort centroAcopioQueryPort;

    public ConsultarInventarioUseCaseImpl(InventarioRepository inventarioRepository,
                                          CentroAcopioQueryPort centroAcopioQueryPort) {
        this.inventarioRepository = inventarioRepository;
        this.centroAcopioQueryPort = centroAcopioQueryPort;
    }

    @Override
    public List<ItemInventario> consultar(UUID centroAcopioId) {
        if (!centroAcopioQueryPort.existe(centroAcopioId)) {
            throw new CentroAcopioNoEncontradoException(centroAcopioId);
        }
        return inventarioRepository.listarPorCentro(centroAcopioId);
    }
}
