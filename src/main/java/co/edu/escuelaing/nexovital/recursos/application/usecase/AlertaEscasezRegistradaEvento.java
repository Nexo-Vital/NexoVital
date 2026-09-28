package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;

import java.util.Objects;

/**
 * Application event published when a rejected dispatch CREATES or UPDATES a
 * shortage alert. Its post-commit listener hands the projection to the
 * {@link co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort}, so the
 * push never happens inside the transaction (contract golden rule: publish
 * POST-COMMIT). Mirror of {@code DonacionRegistradaEvento} and
 * {@code StockDespachadoEvento}.
 *
 * <p><b>Which transaction the listener binds to (FA-6).</b> This event is
 * published from {@code RegistrarAlertaEscasezUseCaseImpl}, whose method runs in
 * its OWN transaction ({@code REQUIRES_NEW}) because the rejected dispatch rolls
 * back. Spring therefore registers the {@code AFTER_COMMIT} synchronization on
 * that transaction, and the listener fires when the ALERT commits — not when the
 * dispatch rolls back. Publishing from the dispatch branch instead would bind
 * the listener to the rolling-back transaction and no frame would ever be sent.
 *
 * <p>It carries the domain {@link AlertaEscasez} plus the stock seen when the
 * dispatch was rejected: the listener projects {@code faltante} from them, so the
 * wire shape is built in one place and the domain stays framework-free.
 */
public record AlertaEscasezRegistradaEvento(AlertaEscasez alerta, int disponibleActual) {

    public AlertaEscasezRegistradaEvento {
        Objects.requireNonNull(alerta, "alerta es obligatoria");
    }
}
