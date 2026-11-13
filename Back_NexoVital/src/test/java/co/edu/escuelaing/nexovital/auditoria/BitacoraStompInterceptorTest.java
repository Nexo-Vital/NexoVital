package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in.AtributosBitacora;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in.BitacoraStompInterceptor;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.access.AccessDeniedException;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * T14/T16 del canal en tiempo real: se registran CONNECT, SUBSCRIBE,
 * DISCONNECT y todo frame rechazado; los mensajes normales no.
 */
class BitacoraStompInterceptorTest {

    private final List<PeticionRegistrada> registradas = new ArrayList<>();
    private final BitacoraPeticionesPort port = new BitacoraPeticionesPort() {
        @Override
        public void registrar(PeticionRegistrada peticion) {
            registradas.add(peticion);
        }

        @Override
        public List<PeticionRegistrada> buscar(FiltroBitacora filtro) {
            return List.of();
        }
    };
    private final BitacoraStompInterceptor interceptor = new BitacoraStompInterceptor(
            port, Clock.fixed(Instant.parse("2026-11-12T12:00:00Z"), ZoneOffset.UTC), "backend-1", true);
    private final MessageChannel canal = mock(MessageChannel.class);

    @Test
    @DisplayName("CONNECT aceptado: queda con la IP y el navegador del handshake")
    void connectAceptado() {
        interceptor.afterSendCompletion(frame(StompCommand.CONNECT, null, sesion()), canal, true, null);

        PeticionRegistrada fila = unica();
        assertEquals(PeticionRegistrada.CANAL_STOMP, fila.canal());
        assertEquals("CONNECT", fila.metodo());
        assertEquals(200, fila.estado());
        assertEquals("190.24.1.1", fila.ip());
        assertEquals("Mozilla/5.0 Prueba", fila.navegador());
        assertEquals("stomp-sesion-1", fila.traceId());
        assertEquals("backend-1", fila.instancia());
        assertEquals(PeticionRegistrada.ACTOR_ANONIMO, fila.actor());
    }

    @Test
    @DisplayName("CONNECT rechazado: queda con 403 y el motivo que dejo la autenticacion")
    void connectRechazado() {
        Map<String, Object> sesion = sesion();
        sesion.put(AtributosBitacora.MOTIVO, "token_ausente");

        interceptor.afterSendCompletion(frame(StompCommand.CONNECT, null, sesion), canal, false,
                new AccessDeniedException("sin token"));

        PeticionRegistrada fila = unica();
        assertEquals(403, fila.estado());
        assertEquals("token_ausente", fila.detalle());
        assertNull(sesion.get(AtributosBitacora.MOTIVO), "el motivo se consume: no se repite en el siguiente frame");
    }

    @Test
    @DisplayName("SUBSCRIBE y DISCONNECT quedan con el destino")
    void subscribeYDisconnect() {
        interceptor.afterSendCompletion(frame(StompCommand.SUBSCRIBE, "/topic/flota", sesion()), canal, true, null);
        interceptor.afterSendCompletion(frame(StompCommand.DISCONNECT, null, sesion()), canal, true, null);

        assertEquals(2, registradas.size());
        assertEquals("SUBSCRIBE", registradas.get(0).metodo());
        assertEquals("/topic/flota", registradas.get(0).ruta());
        assertEquals("DISCONNECT", registradas.get(1).metodo());
    }

    @Test
    @DisplayName("Un SEND normal no se registra; uno descartado por destino prohibido si")
    void sendSoloSiSeRechaza() {
        interceptor.afterSendCompletion(frame(StompCommand.SEND, "/app/algo", sesion()), canal, true, null);
        assertTrue(registradas.isEmpty(), "los mensajes normales no llenan la bitacora");

        interceptor.afterSendCompletion(frame(StompCommand.SEND, "/topic/flota", sesion()), canal, false, null);
        PeticionRegistrada fila = unica();
        assertEquals(403, fila.estado());
        assertEquals("destino_no_permitido", fila.detalle());
    }

    @Test
    @DisplayName("Deshabilitada, no registra nada")
    void deshabilitada() {
        BitacoraStompInterceptor apagado = new BitacoraStompInterceptor(port, Clock.systemUTC(), "x", false);
        apagado.afterSendCompletion(frame(StompCommand.CONNECT, null, sesion()), canal, true, null);
        assertTrue(registradas.isEmpty());
    }

    private PeticionRegistrada unica() {
        assertEquals(1, registradas.size());
        return registradas.get(0);
    }

    private static Map<String, Object> sesion() {
        Map<String, Object> sesion = new HashMap<>();
        sesion.put(AtributosBitacora.IP_SESION, "190.24.1.1");
        sesion.put(AtributosBitacora.NAVEGADOR_SESION, "Mozilla/5.0 Prueba");
        return sesion;
    }

    private static Message<byte[]> frame(StompCommand comando, String destino, Map<String, Object> sesion) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(comando);
        accessor.setSessionId("sesion-1");
        accessor.setSessionAttributes(sesion);
        if (destino != null) {
            accessor.setDestination(destino);
        }
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }
}
