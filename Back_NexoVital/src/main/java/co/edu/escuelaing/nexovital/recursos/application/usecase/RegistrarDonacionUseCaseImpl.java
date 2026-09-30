package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroAcopioQueryPort;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Registra una donación: valida la cantidad, confirma que el centro y el item
 * existan, acredita el stock de forma atómica en la base y publica un evento que
 * el listener post-commit entrega al {@code PushPort}.
 *
 * <p>La transacción envuelve solo la persistencia. El push va DESPUÉS del commit
 * (regla de oro del contrato): el evento se consume con
 * {@code @TransactionalEventListener(AFTER_COMMIT)} en
 * {@link InventarioPushListener}.
 *
 * <p>El crédito NO se calcula en Java para escribirlo: se aplica con una sola
 * sentencia SQL ({@link InventarioRepository#acreditar}), de modo que dos
 * donaciones concurrentes no pierden una actualización. El valor devuelto y el
 * payload del evento se releen de la base DESPUÉS del crédito atómico
 * ({@link InventarioRepository#buscar}); así la base es la única fuente de
 * verdad, también bajo concurrencia, y el evento publica el stock real y no un
 * cálculo en Java. El evento lleva el {@code ItemInventarioDto} ya proyectado,
 * la misma forma que el módulo sirve por REST.
 */
@Service
public class RegistrarDonacionUseCaseImpl implements RegistrarDonacionUseCase {

    private final InventarioRepository inventarioRepository;
    private final CentroAcopioQueryPort centroAcopioQueryPort;
    private final ApplicationEventPublisher eventPublisher;

    public RegistrarDonacionUseCaseImpl(InventarioRepository inventarioRepository,
                                        CentroAcopioQueryPort centroAcopioQueryPort,
                                        ApplicationEventPublisher eventPublisher) {
        this.inventarioRepository = inventarioRepository;
        this.centroAcopioQueryPort = centroAcopioQueryPort;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public ItemInventario donar(UUID centroAcopioId, UUID itemId, int cantidad) {
        if (cantidad < 1) {
            throw new IllegalArgumentException("La cantidad a donar debe ser un entero positivo.");
        }
        if (!centroAcopioQueryPort.existe(centroAcopioId)) {
            throw new CentroAcopioNoEncontradoException(centroAcopioId);
        }

        // Crédito atómico en la base: UNA sentencia, nunca read-modify-write.
        if (!inventarioRepository.acreditar(centroAcopioId, itemId, cantidad)) {
            throw new ItemInventarioNoEncontradoException(centroAcopioId, itemId);
        }

        // Fuente de verdad: se RELEE el item después del crédito. La entidad
        // cacheada se descartó (`clearAutomatically`), así que esta lectura ve el
        // stock que la base tiene ahora y no un cálculo en Java. Bajo dos
        // donaciones concurrentes, cada transacción publica el estado que sí
        // commiteó, nunca un valor que la base no sostiene.
        ItemInventario acreditado = inventarioRepository.buscar(centroAcopioId, itemId)
                .orElseThrow(() -> new ItemInventarioNoEncontradoException(centroAcopioId, itemId));
        eventPublisher.publishEvent(new DonacionRegistradaEvento(ItemInventarioDto.fromDomain(acreditado)));
        return acreditado;
    }
}
