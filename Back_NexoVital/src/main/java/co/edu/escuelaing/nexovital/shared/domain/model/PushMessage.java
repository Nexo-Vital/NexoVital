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
 * <p><b>Instrumentación (T27).</b> {@code emitidoEn}, {@code consecutivo} e
 * {@code instancia} los asigna la instancia que origina el evento, una sola vez.
 * Viajan dentro del mensaje —y no se recalculan al entregar— para que todas las
 * instancias entreguen la misma marca y el mismo consecutivo: si cada nodo
 * numerara al entregar, el receptor vería dos secuencias distintas del mismo
 * evento.
 *
 * @param destino destino STOMP (p. ej. {@code /topic/emergencias})
 * @param payload carga ya proyectada por el módulo dueño
 * @param usuario destinatario de una entrega por usuario, o {@code null} para
 *                un destino de tópico/cola compartido
 * @param emitidoEn epoch en milisegundos del momento de publicación, o
 *                  {@code null} si el mensaje todavía no se instrumentó
 * @param consecutivo número creciente por instancia y destino, o {@code null}
 * @param instancia identificador de la instancia que publicó, o {@code null}
 */
public record PushMessage(
        String destino,
        Object payload,
        String usuario,
        String emitidoEn,
        String consecutivo,
        String instancia) {

    /** Tópico/cola compartido, sin instrumentar. */
    public PushMessage(String destino, Object payload) {
        this(destino, payload, null, null, null, null);
    }

    /** Destino por usuario, sin instrumentar. */
    public PushMessage(String destino, Object payload, String usuario) {
        this(destino, payload, usuario, null, null, null);
    }

    public PushMessage {
        Objects.requireNonNull(destino, "destino es obligatorio");
        Objects.requireNonNull(payload, "payload es obligatorio");
    }

    /** {@code true} si ya lleva la instrumentación de origen. */
    public boolean instrumentado() {
        return emitidoEn != null && consecutivo != null && instancia != null;
    }
}
