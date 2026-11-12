package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.lang.NonNull;
import org.springframework.lang.Nullable;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.security.Principal;
import java.time.Clock;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Bitácora del canal en tiempo real (T14). Por decisión del equipo no se
 * registra cada mensaje del WebSocket —serían miles por minuto con las
 * posiciones de la flota—, solo lo que cambia quién está escuchando y los
 * rechazos: {@code CONNECT}, {@code SUBSCRIBE}, {@code DISCONNECT} y cualquier
 * frame que el servidor no aceptó.
 *
 * <p><b>Va primero en el canal de entrada.</b> Así su
 * {@link #afterSendCompletion} se llama aunque el interceptor de autenticación
 * rechace el frame con una excepción: Spring avisa a los interceptores que ya
 * pasaron por {@code preSend}, y este es el primero.
 *
 * <p><b>IP y navegador.</b> Un frame STOMP no trae la IP ni el User-Agent: se
 * toman del handshake HTTP con {@link #handshake()} y se guardan en la sesión.
 */
@Component
public class BitacoraStompInterceptor implements ChannelInterceptor {

    private static final Set<StompCommand> REGISTRABLES =
            Set.of(StompCommand.CONNECT, StompCommand.SUBSCRIBE, StompCommand.DISCONNECT);

    private static final int ESTADO_ACEPTADO = 200;
    private static final int ESTADO_RECHAZADO = 403;

    private final BitacoraPeticionesPort bitacora;
    private final Clock clock;
    private final String instancia;
    private final boolean habilitada;

    public BitacoraStompInterceptor(BitacoraPeticionesPort bitacora,
                                    Clock clock,
                                    @Value("${nexovital.instancia-id:local}") String instancia,
                                    @Value("${nexovital.bitacora.enabled:true}") boolean habilitada) {
        this.bitacora = bitacora;
        this.clock = clock;
        this.instancia = instancia;
        this.habilitada = habilitada;
    }

    @Override
    public void afterSendCompletion(@NonNull Message<?> message, @NonNull MessageChannel channel,
                                    boolean sent, @Nullable Exception ex) {
        if (!habilitada) {
            return;
        }
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) {
            accessor = StompHeaderAccessor.wrap(message);
        }
        StompCommand comando = accessor.getCommand();
        if (comando == null) {
            return;
        }
        boolean rechazado = ex != null || !sent;
        if (!rechazado && !REGISTRABLES.contains(comando)) {
            return;
        }
        bitacora.registrar(armar(accessor, comando, rechazado));
    }

    private PeticionRegistrada armar(StompHeaderAccessor accessor, StompCommand comando, boolean rechazado) {
        Map<String, Object> sesion = accessor.getSessionAttributes();
        Usuario usuario = usuarioDe(accessor.getUser());
        Object motivo = null;
        if (sesion != null) {
            motivo = sesion.remove(AtributosBitacora.MOTIVO);
        }
        if (rechazado && motivo == null && StompCommand.SEND.equals(comando)) {
            motivo = "destino_no_permitido";
        }
        String sesionId = accessor.getSessionId();
        return new PeticionRegistrada(
                UUID.randomUUID(),
                clock.instant(),
                PeticionRegistrada.CANAL_STOMP,
                comando.name(),
                BitacoraPeticionesFilter.recortar(accessor.getDestination(), 500),
                rechazado ? ESTADO_RECHAZADO : ESTADO_ACEPTADO,
                null,
                usuario == null ? null : usuario.getId(),
                usuario == null ? null : usuario.getRol().name(),
                usuario == null ? PeticionRegistrada.ACTOR_ANONIMO : usuario.getEmail(),
                textoDe(sesion, AtributosBitacora.IP_SESION),
                null,
                textoDe(sesion, AtributosBitacora.NAVEGADOR_SESION),
                // Todas las líneas de una misma sesión comparten este id: se
                // puede seguir la vida de una conexión filtrando por él.
                sesionId == null ? null : BitacoraPeticionesFilter.recortar("stomp-" + sesionId, 64),
                instancia,
                motivo == null ? null : motivo.toString());
    }

    private static Usuario usuarioDe(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof Usuario usuario) {
            return usuario;
        }
        return null;
    }

    private static String textoDe(Map<String, Object> sesion, String clave) {
        if (sesion == null) {
            return null;
        }
        Object valor = sesion.get(clave);
        return valor == null ? null : valor.toString();
    }

    /**
     * Guarda la IP y el navegador del handshake en los atributos de la sesión
     * STOMP. Se registra en {@code WebSocketConfig}.
     */
    public HandshakeInterceptor handshake() {
        return new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(@NonNull ServerHttpRequest request, @NonNull ServerHttpResponse response,
                                           @NonNull WebSocketHandler wsHandler,
                                           @NonNull Map<String, Object> attributes) {
                String ip;
                if (request instanceof ServletServerHttpRequest servlet) {
                    ip = IpCliente.de(servlet.getServletRequest());
                } else {
                    ip = IpCliente.de(request.getHeaders().getFirst(IpCliente.CABECERA),
                            request.getRemoteAddress() == null
                                    ? null
                                    : request.getRemoteAddress().getAddress().getHostAddress());
                }
                if (ip != null) {
                    attributes.put(AtributosBitacora.IP_SESION, ip);
                }
                String navegador = BitacoraPeticionesFilter.recortar(
                        request.getHeaders().getFirst("User-Agent"), 300);
                if (navegador != null) {
                    attributes.put(AtributosBitacora.NAVEGADOR_SESION, navegador);
                }
                return true;
            }

            @Override
            public void afterHandshake(@NonNull ServerHttpRequest request, @NonNull ServerHttpResponse response,
                                       @NonNull WebSocketHandler wsHandler, @Nullable Exception exception) {
                // Nada que hacer: el handshake ya quedó en la bitácora HTTP.
            }
        };
    }
}
