package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * The gateway fan-out is the ONLY place that knows the broker, so it is the
 * place that must choose {@code convertAndSendToUser} vs {@code convertAndSend}:
 * a user message is the C2 broadcast (one copy per unit, D-F1); a shared message
 * is a topic/queue. Using the shared form for the broadcast would be round-robin
 * and would reach only one subscriber.
 */
@ExtendWith(MockitoExtension.class)
class PushFanOutAdapterTest {

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @Test
    void mensajeConUsuarioSeEntregaConConvertAndSendToUser() {
        PushFanOutAdapter adapter = new PushFanOutAdapter(messagingTemplate);
        Object payload = "payload";

        adapter.alSolicitarPush(new PushMessage("/queue/solicitudes", payload, "conductor-1"));

        verify(messagingTemplate).convertAndSendToUser("conductor-1", "/queue/solicitudes", payload);
        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class));
    }

    @Test
    void mensajeSinUsuarioSeEntregaConConvertAndSend() {
        PushFanOutAdapter adapter = new PushFanOutAdapter(messagingTemplate);
        Object payload = "payload";

        adapter.alSolicitarPush(new PushMessage("/topic/flota", payload));

        verify(messagingTemplate).convertAndSend("/topic/flota", payload);
        verify(messagingTemplate, never()).convertAndSendToUser(anyString(), anyString(), any());
    }
}
