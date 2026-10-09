package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.ConfirmarLlegadasVencidasUseCase;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Periodic sweep that confirms arrivals the citizen did not answer in time. */
@Component
public class ConfirmacionAutomaticaScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(ConfirmacionAutomaticaScheduler.class);

    private final ConfirmarLlegadasVencidasUseCase confirmarLlegadasVencidasUseCase;

    public ConfirmacionAutomaticaScheduler(ConfirmarLlegadasVencidasUseCase confirmarLlegadasVencidasUseCase) {
        this.confirmarLlegadasVencidasUseCase = confirmarLlegadasVencidasUseCase;
    }

    @Scheduled(
            initialDelayString = "${nexovital.solicitud.confirmacion-automatica-delay-inicial-ms:0}",
            fixedDelayString = "${nexovital.solicitud.confirmacion-automatica-intervalo-ms:2000}")
    public void confirmarLlegadasVencidas() {
        try {
            int confirmadas = confirmarLlegadasVencidasUseCase.confirmarVencidas();
            if (confirmadas > 0) {
                LOG.info("Llegadas confirmadas automáticamente: {}", confirmadas);
            }
        } catch (RuntimeException e) {
            // A transient failure must not stop the sweep; the next cycle retries.
            LOG.warn("Fallo al confirmar llegadas vencidas; se reintentará en el próximo ciclo", e);
        }
    }
}
