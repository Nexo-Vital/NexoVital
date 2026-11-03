package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The gateway fan-out is the ONLY place that knows the broker, so it is the
 * place that must choose {@code convertAndSendToUser} vs {@code convertAndSend}:
 * a user message is the C2 broadcast (one copy per unit, D-F1); a shared message
 * is a topic/queue. Using the shared form for the broadcast would be round-robin
 * and would reach only one subscriber.
 *
 * <p>La instrumentación de T27 viaja en cabeceras, no en el cuerpo: el contrato
 * con el frontend no cambia. El consecutivo es por instancia y destino, así que
 * dos destinos distintos llevan secuencias independientes.
 */
@ExtendWith(MockitoExtension.class)
class PushFanOutAdapterTest {

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @Test
    void mensajeConUsuarioSeEntregaConConvertAndSendToUser() {
        PushFanOutAdapter adapter = new PushFanOutAdapter(messagingTemplate, "backend-1");
        Object payload = "payload";

        adapter.alSolicitarPush(new PushMessage("/queue/solicitudes", payload, "conductor-1"));

        verify(messagingTemplate)
                .convertAndSendToUser(eq("conductor-1"), eq("/queue/solicitudes"), eq(payload), anyMap());
        verify(messagingTemplate, never()).convertAndSend(anyString(), any(Object.class), anyMap());
    }

    @Test
    void mensajeSinUsuarioSeEntregaConConvertAndSend() {
        PushFanOutAdapter adapter = new PushFanOutAdapter(messagingTemplate, "backend-1");
        Object payload = "payload";

        adapter.alSolicitarPush(new PushMessage("/topic/flota", payload));

        verify(messagingTemplate).convertAndSend(eq("/topic/flota"), eq(payload), anyMap());
        verify(messagingTemplate, never()).convertAndSendToUser(anyString(), anyString(), any(), anyMap());
    }

    @Test
    void laInstrumentacionViajaEnCabecerasConConsecutivoPorDestino() {
        PushFanOutAdapter adapter = new PushFanOutAdapter(messagingTemplate, "backend-1");
        Object payload = "payload";

        adapter.alSolicitarPush(new PushMessage("/topic/flota", payload));
        adapter.alSolicitarPush(new PushMessage("/topic/flota", payload));
        adapter.alSolicitarPush(new PushMessage("/topic/emergencias", payload));

        ArgumentCaptor<Map<String, Object>> cabeceras = ArgumentCaptor.forClass(Map.class);
        verify(messagingTemplate, times(3))
                .convertAndSend(anyString(), any(Object.class), cabeceras.capture());

        List<Map<String, Object>> capturadas = cabeceras.getAllValues();

        assertEquals("1", capturadas.get(0).get(PushFanOutAdapter.CABECERA_CONSECUTIVO));
        assertEquals("2", capturadas.get(1).get(PushFanOutAdapter.CABECERA_CONSECUTIVO));
        assertEquals("1", capturadas.get(2).get(PushFanOutAdapter.CABECERA_CONSECUTIVO),
                "cada destino tiene su propia secuencia");

        assertEquals("backend-1", capturadas.get(0).get(PushFanOutAdapter.CABECERA_INSTANCIA));

        String emitidoEn = (String) capturadas.get(0).get(PushFanOutAdapter.CABECERA_EMITIDO_EN);
        assertTrue(Long.parseLong(emitidoEn) > 0, "emitidoEn debe ser un epoch de milisegundos");
    }

    @Test
    void conBrokerPublicaEnElExchangeYNoEntregaLocal() {
        @SuppressWarnings("unchecked")
        ObjectProvider<RabbitTemplate> provider = mock(ObjectProvider.class);
        RabbitTemplate rabbitTemplate = mock(RabbitTemplate.class);
        when(provider.getIfAvailable()).thenReturn(rabbitTemplate);

        PushFanOutAdapter adapter = new PushFanOutAdapter(
                messagingTemplate, provider, true, "nexovital.push", "backend-1");

        adapter.alSolicitarPush(new PushMessage("/topic/flota", "payload"));

        ArgumentCaptor<PushMessage> enviado = ArgumentCaptor.forClass(PushMessage.class);
        verify(rabbitTemplate).convertAndSend(eq("nexovital.push"), eq(""), enviado.capture());

        assertEquals("backend-1", enviado.getValue().instancia());
        assertNotNull(enviado.getValue().consecutivo());
        assertEquals("1", enviado.getValue().consecutivo());
        // La instancia de origen tambien recibe su copia por su propia cola:
        // entregar aca seria una entrega doble.
        verifyNoInteractions(messagingTemplate);
    }
}
