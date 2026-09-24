package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.port.out.PushPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Entrega al {@link PushPort} el payload de una emergencia recién registrada,
 * SIEMPRE después del commit. La fase {@code AFTER_COMMIT} garantiza que el
 * consumidor nunca vea un evento que la base no confirmó: es la regla de oro del
 * contrato ("publish POST-COMMIT").
 *
 * <p>El destino es {@code /topic/emergencias}, el que el contrato ya declara
 * para "Nueva emergencia reportada". El canal real (STOMP y gateway) lo
 * implementa la tarea 244 (US2): el adaptador del puerto publica el payload como
 * evento de aplicación y el gateway lo hace fan-out a las sesiones suscritas.
 *
 * <p>El payload que se entrega es el agregado de dominio, cuya forma pública ya
 * coincide con el schema {@code Emergencia} del contrato; el gateway lo serializa
 * a JSON con el conversor de mensajes de Spring.
 */
@Component
public class EmergenciaPushListener {

    /** Destino ya declarado en el contrato para una emergencia nueva. */
    public static final String DESTINO_EMERGENCIAS = "/topic/emergencias";

    private final PushPort pushPort;

    public EmergenciaPushListener(PushPort pushPort) {
        this.pushPort = pushPort;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRegistrarEmergencia(EmergenciaRegistradaEvento evento) {
        pushPort.publicar(DESTINO_EMERGENCIAS, evento.emergencia());
    }
}
