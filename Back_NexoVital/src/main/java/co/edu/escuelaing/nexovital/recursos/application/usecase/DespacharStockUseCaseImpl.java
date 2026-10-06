package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.StockInsuficienteException;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.DespacharStockUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroAcopioQueryPort;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Dispatches stock with the C1 invariant guaranteed BY CONSTRUCTION: the
 * decrement is one conditional statement
 * ({@code SET disponible = disponible - :cantidad WHERE ... AND disponible >=
 * :cantidad}, see
 * {@link InventarioRepository#transicionAtomicaDespacho}). 1 affected row = this
 * caller took the stock; 0 rows = the stock no longer covered the quantity and
 * the request is rejected with {@code 409} instead of going negative.
 *
 * <p>The check is the {@code WHERE} clause, not a read-check-write in Java. The
 * transaction wraps only the persistence; the realtime push travels through a
 * post-commit event listener, never from the controller.
 *
 * <p><b>Divergence from the reference backend:</b> its model carries a
 * {@code version} column that its CAS increments. This module's
 * {@link ItemInventario} has {@code unidad} / {@code unitDetail} instead and NO
 * {@code version}; the conditional update alone provides the C1 guarantee, and
 * adding a column would force a schema migration production's {@code validate}
 * would reject. The port is adapted to this model and its extra fields are
 * preserved.
 */
@Service
public class DespacharStockUseCaseImpl implements DespacharStockUseCase {

    private final InventarioRepository inventarioRepository;
    private final CentroAcopioQueryPort centroAcopioQueryPort;
    private final ApplicationEventPublisher eventPublisher;

    public DespacharStockUseCaseImpl(InventarioRepository inventarioRepository,
                                     CentroAcopioQueryPort centroAcopioQueryPort,
                                     ApplicationEventPublisher eventPublisher) {
        this.inventarioRepository = inventarioRepository;
        this.centroAcopioQueryPort = centroAcopioQueryPort;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public ItemInventario despachar(UUID centroAcopioId, UUID itemId, int cantidad) {
        if (cantidad < 1) {
            throw new IllegalArgumentException("La cantidad a despachar debe ser un entero positivo.");
        }
        if (!centroAcopioQueryPort.existe(centroAcopioId)) {
            throw new CentroAcopioNoEncontradoException(centroAcopioId);
        }

        // CAS: ONE conditional statement, never read-modify-write in Java.
        if (inventarioRepository.transicionAtomicaDespacho(centroAcopioId, itemId, cantidad) == 0) {
            // 0 rows means either "no such item in this center" (404) or "not
            // enough stock" (409). A re-read tells them apart and reports the
            // fresh available quantity; the CAS is still the sole authority.
            ItemInventario sinStock = inventarioRepository.buscar(centroAcopioId, itemId)
                    .orElseThrow(() -> new ItemInventarioNoEncontradoException(centroAcopioId, itemId));
            // A rejected withdrawal changes nothing: the shortage alert is not
            // born here, it is derived from the inventory (stock below what the
            // center declared it needs).
            throw new StockInsuficienteException(
                    centroAcopioId, itemId, sinStock.getNombre(), sinStock.getDisponible(), cantidad);
        }

        // Source of truth: re-read AFTER the atomic decrement. The cached
        // entity was discarded (`clearAutomatically`), so this read sees the
        // stock the database now holds, never a Java calculation.
        ItemInventario despachado = inventarioRepository.buscar(centroAcopioId, itemId)
                .orElseThrow(() -> new ItemInventarioNoEncontradoException(centroAcopioId, itemId));
        eventPublisher.publishEvent(new StockDespachadoEvento(ItemInventarioDto.fromDomain(despachado)));
        return despachado;
    }
}
