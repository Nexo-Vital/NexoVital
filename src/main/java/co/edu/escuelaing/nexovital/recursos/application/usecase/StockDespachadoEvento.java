package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;

import java.util.Objects;

/**
 * Application event published after a successful dispatch. Its post-commit
 * listener delivers the payload to the
 * {@link co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort}, so the
 * push never happens inside the transaction (contract golden rule: publish
 * POST-COMMIT). It carries the {@link ItemInventarioDto} already projected: the
 * same public shape the module serves over REST. Mirror of
 * {@code DonacionRegistradaEvento}.
 */
public record StockDespachadoEvento(ItemInventarioDto item) {

    public StockDespachadoEvento {
        Objects.requireNonNull(item, "item is required");
    }
}
