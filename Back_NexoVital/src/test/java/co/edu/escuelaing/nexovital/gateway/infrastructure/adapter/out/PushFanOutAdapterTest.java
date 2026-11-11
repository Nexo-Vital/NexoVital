package co.edu.escuelaing.nexovital.gateway.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.observabilidad.infrastructure.TraceId;
import co.edu.escuelaing.nexovital.shared.domain.model.PushMessage;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.AmqpConnectException;
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
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
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

    @AfterEach
    void limpiarTraceId() {
        TraceId.limpiar();
    }

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

    @Test
    void siRabbitMqNoRespondeElEventoSeEntregaLocalYNoSePierde() {
        @SuppressWarnings("unchecked")
        ObjectProvider<RabbitTemplate> provider = mock(ObjectProvider.class);
        RabbitTemplate rabbitTemplate = mock(RabbitTemplate.class);
        when(provider.getIfAvailable()).thenReturn(rabbitTemplate);
        doThrow(new AmqpConnectException(new java.net.ConnectException("Connection refused")))
                .when(rabbitTemplate).convertAndSend(eq("nexovital.push"), eq(""), any(PushMessage.class));

        PushFanOutAdapter adapter = new PushFanOutAdapter(
                messagingTemplate, provider, true, "nexovital.push", "backend-1");

        adapter.alSolicitarPush(new PushMessage("/topic/flota", "payload"));

        // T04: con el broker caído, los clientes de ESTA instancia igual reciben
        // el evento, con su instrumentación intacta.
        ArgumentCaptor<Map<String, Object>> cabeceras = ArgumentCaptor.forClass(Map.class);
        verify(messagingTemplate, times(1)).convertAndSend(eq("/topic/flota"), eq("payload"), cabeceras.capture());
        assertEquals("backend-1", cabeceras.getValue().get(PushFanOutAdapter.CABECERA_INSTANCIA));
        assertEquals("1", cabeceras.getValue().get(PushFanOutAdapter.CABECERA_CONSECUTIVO));
    }

    // -----------------------------------------------------------------------
    // T34/T35 — el traceId sigue al evento entre dos instancias
    // -----------------------------------------------------------------------

    @Test
    void elTraceIdDeLaPeticionViajaDentroDelMensajeDelBrokerYEnLaCabeceraStomp() {
        TraceId.poner("trace-origen-123");
        ObjectProvider<RabbitTemplate> provider = mock(ObjectProvider.class);
        RabbitTemplate rabbitTemplate = mock(RabbitTemplate.class);
        when(provider.getIfAvailable()).thenReturn(rabbitTemplate);

        PushFanOutAdapter adapter = new PushFanOutAdapter(
                messagingTemplate, provider, true, "nexovital.push", "backend-1");

        adapter.alSolicitarPush(new PushMessage("/topic/flota", "payload"));

        ArgumentCaptor<PushMessage> enviado = ArgumentCaptor.forClass(PushMessage.class);
        verify(rabbitTemplate).convertAndSend(eq("nexovital.push"), eq(""), enviado.capture());
        assertEquals("trace-origen-123", enviado.getValue().traceId(),
                "el id de correlación viaja dentro del mensaje que cruza por RabbitMQ");
    }

    @Test
    void laSegundaInstanciaEntregaElEventoConElTraceIdDelOrigen() {
        String trace = "trace-de-la-otra-instancia";
        TraceId.poner(trace);
        ObjectProvider<RabbitTemplate> provider = mock(ObjectProvider.class);
        RabbitTemplate rabbitTemplate = mock(RabbitTemplate.class);
        when(provider.getIfAvailable()).thenReturn(rabbitTemplate);

        // Instancia A: publica al broker.
        PushFanOutAdapter origen = new PushFanOutAdapter(
                messagingTemplate, provider, true, "nexovital.push", "backend-1");
        origen.alSolicitarPush(new PushMessage("/topic/emergencias", "payload"));

        ArgumentCaptor<PushMessage> enviado = ArgumentCaptor.forClass(PushMessage.class);
        verify(rabbitTemplate).convertAndSend(eq("nexovital.push"), eq(""), enviado.capture());
        TraceId.limpiar();

        // Instancia B: recibe la copia del broker y la entrega a sus sesiones.
        SimpMessagingTemplate sesionesB = mock(SimpMessagingTemplate.class);
        AtomicReference<String> traceEnEntrega = new AtomicReference<>();
        AtomicReference<Map<String, Object>> cabeceras = new AtomicReference<>();
        doAnswer(invocacion -> {
            traceEnEntrega.set(TraceId.actual());
            cabeceras.set(invocacion.getArgument(2));
            return null;
        }).when(sesionesB).convertAndSend(anyString(), any(Object.class), anyMap());

        new PushFanOutAdapter(sesionesB, "backend-2").entregarLocal(enviado.getValue());

        assertEquals(trace, traceEnEntrega.get(),
                "la instancia que entrega publica en su MDC el traceId del origen");
        assertEquals(trace, cabeceras.get().get(PushFanOutAdapter.CABECERA_TRACE_ID),
                "el traceId viaja también como cabecera STOMP");
        assertEquals(enviado.getValue().consecutivo(),
                cabeceras.get().get(PushFanOutAdapter.CABECERA_CONSECUTIVO),
                "el consecutivo es el mismo en las dos instancias");
        assertEquals("backend-1", cabeceras.get().get(PushFanOutAdapter.CABECERA_INSTANCIA),
                "la instancia de origen no se reescribe al entregar");
    }

    // -----------------------------------------------------------------------
    // T38 (H6) — la latencia de eventos en tiempo real se mide al entregar
    // -----------------------------------------------------------------------

    @Test
    void alEntregarMideLaLatenciaDesdeQueSePublicoElEvento() {
        SimpleMeterRegistry registro = new SimpleMeterRegistry();
        PushFanOutAdapter adapter = new PushFanOutAdapter(
                messagingTemplate, null, false, "nexovital.push", "backend-2", registro);
        String hace200ms = Long.toString(System.currentTimeMillis() - 200);

        // El evento nacio en backend-1 y lo entrega backend-2 (salto por RabbitMQ).
        adapter.entregarLocal(new PushMessage(
                "/topic/flota", "payload", null, hace200ms, "1", "backend-1", null));

        Timer timer = registro.find(PushFanOutAdapter.METRICA_PROPAGACION).tag("origen", "backend-1").timer();
        assertNotNull(timer, "la entrega debe registrar la latencia de propagacion");
        assertEquals(1, timer.count());
        assertTrue(timer.totalTime(TimeUnit.MILLISECONDS) >= 200,
                "mide desde emitidoEn, no desde que llego a esta instancia");
    }

    @Test
    void unMensajeSinInstanteDeOrigenNoSeMide() {
        SimpleMeterRegistry registro = new SimpleMeterRegistry();
        PushFanOutAdapter adapter = new PushFanOutAdapter(
                messagingTemplate, null, false, "nexovital.push", "backend-1", registro);

        adapter.entregarLocal(new PushMessage("/topic/flota", "payload"));

        assertTrue(registro.find(PushFanOutAdapter.METRICA_PROPAGACION).timers().isEmpty(),
                "sin emitidoEn no hay contra que medir");
    }
}
