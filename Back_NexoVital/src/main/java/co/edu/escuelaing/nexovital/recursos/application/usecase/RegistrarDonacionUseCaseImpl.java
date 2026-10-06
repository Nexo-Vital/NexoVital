package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroAcopioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioNoEncontradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.NecesidadCubiertaException;
import co.edu.escuelaing.nexovital.recursos.domain.model.DonacionAceptada;
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
 * Registers a donation capped to what the center still needs.
 *
 * <p>The cap is enforced by the database, not by Java: the credit is ONE
 * conditional statement
 * ({@link InventarioRepository#acreditarSiCabe}: {@code SET disponible =
 * disponible + :a WHERE requerido - disponible >= :a}). Reading the gap first is
 * only a proposal of how much to take ({@code a = min(cantidad, faltante)}); if
 * another donor filled part of the need in between, the statement affects 0 rows
 * and the gap is read again. Each failed attempt means somebody else made
 * progress, so the loop ends: either this donor credits what fits or finds the
 * need covered and gets {@link NecesidadCubiertaException}.
 *
 * <p>Two donors offering 10 to a need of 10: one credits 10, the other finds a
 * gap of 0 and is rejected. Two donors offering 6 to a need of 10: one credits
 * 6, the other only the 4 that complete it.
 *
 * <p>The transaction wraps only the persistence; the realtime push goes after
 * the commit through {@link InventarioPushListener}.
 */
@Service
public class RegistrarDonacionUseCaseImpl implements RegistrarDonacionUseCase {

    /** Safety net; every retry means another donor progressed, so it is never reached in practice. */
    private static final int INTENTOS_MAXIMOS = 100;

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
    public DonacionAceptada donar(UUID centroAcopioId, UUID itemId, int cantidad) {
        if (cantidad < 1) {
            throw new IllegalArgumentException("La cantidad a donar debe ser un entero positivo.");
        }
        if (!centroAcopioQueryPort.existe(centroAcopioId)) {
            throw new CentroAcopioNoEncontradoException(centroAcopioId);
        }

        for (int intento = 0; intento < INTENTOS_MAXIMOS; intento++) {
            ItemInventario actual = inventarioRepository.buscar(centroAcopioId, itemId)
                    .orElseThrow(() -> new ItemInventarioNoEncontradoException(centroAcopioId, itemId));
            int faltante = actual.getRequerido() - actual.getDisponible();
            if (faltante <= 0) {
                throw new NecesidadCubiertaException(centroAcopioId, itemId, actual.getNombre());
            }
            int aceptada = Math.min(cantidad, faltante);

            // Bounded credit: ONE conditional statement. 0 rows = someone else
            // filled part of the need after our read; read the gap again.
            if (inventarioRepository.acreditarSiCabe(centroAcopioId, itemId, aceptada) == 1) {
                // Source of truth: re-read after the credit (the cached entity
                // was discarded), so the event carries the stock the database holds.
                ItemInventario acreditado = inventarioRepository.buscar(centroAcopioId, itemId)
                        .orElseThrow(() -> new ItemInventarioNoEncontradoException(centroAcopioId, itemId));
                eventPublisher.publishEvent(new DonacionRegistradaEvento(ItemInventarioDto.fromDomain(acreditado)));
                return new DonacionAceptada(acreditado, aceptada, cantidad);
            }
        }
        throw new IllegalStateException("No fue posible acreditar la donación tras " + INTENTOS_MAXIMOS + " intentos");
    }
}
