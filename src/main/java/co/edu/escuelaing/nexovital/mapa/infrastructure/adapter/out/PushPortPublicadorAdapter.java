package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.mapa.domain.port.out.PushPort;
import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * Adaptador real del {@link PushPort} (MVP, diseño US2 D5): el módulo dueño del
 * dato publica el payload de push ya armado {@code {destination, payload}} como
 * evento de aplicación en proceso. El componente del gateway
 * ({@code gateway/infrastructure/adapter/out/PushFanOutAdapter}) lo reenvía a las
 * sesiones STOMP.
 *
 * <p>Aquí NO se conoce el broker ni STOMP: el fan-out es del gateway (Modelo Y
 * del ADR-0003). Reemplaza al adaptador diferido de la tarea 249, que solo
 * dejaba rastro y descartaba el payload.
 */
@Component
public class PushPortPublicadorAdapter implements PushPort {

    private final ApplicationEventPublisher eventPublisher;

    public PushPortPublicadorAdapter(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    @Override
    public void publicar(String destino, Object payload) {
        eventPublisher.publishEvent(new PushMessage(destino, payload));
    }
}
