package co.edu.escuelaing.nexovital.shared.domain.model;

import java.util.Objects;

/**
 * Mensaje neutral de push: el payload ya armado {@code {destination, payload}}
 * que el módulo dueño del dato entrega al canal de tiempo real (diseño US2 D5).
 *
 * <p>Es a propósito agnóstico del dominio: el gateway solo ve un destino y una
 * carga, nunca un tipo de dominio (Modelo Y del ADR-0003). En el MVP viaja como
 * evento de aplicación en proceso; el destino lo publica al exchange fanout
 * {@code ws.push}.
 *
 * @param destino destino STOMP (p. ej. {@code /topic/emergencias})
 * @param payload carga ya proyectada por el módulo dueño
 * @param usuario destinatario de una entrega por usuario, o {@code null} para
 *                un destino de tópico/cola compartido
 */
public record PushMessage(String destino, Object payload, String usuario) {

    /** Tópico/cola compartido: el gateway entrega con {@code convertAndSend}. */
    public PushMessage(String destino, Object payload) {
        this(destino, payload, null);
    }

    public PushMessage {
        Objects.requireNonNull(destino, "destino es obligatorio");
        Objects.requireNonNull(payload, "payload es obligatorio");
    }
}
