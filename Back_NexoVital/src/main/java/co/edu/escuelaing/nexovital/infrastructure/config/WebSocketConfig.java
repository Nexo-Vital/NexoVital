package co.edu.escuelaing.nexovital.infrastructure.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.util.Arrays;

/**
 * Canal de tiempo real del mapa: STOMP sobre WebSocket en {@code /ws} (con
 * fallback SockJS), broker simple sobre {@code /topic} y {@code /queue} y
 * prefijo de aplicación {@code /app} (diseño US2 D1).
 *
 * <p>Se porta la estructura del {@code WebSocketConfig} de la referencia. El
 * añadido obligatorio es el {@link StompAuthChannelInterceptor} que la referencia
 * NO tiene: sin él su canal STOMP queda abierto (diseño US2 D7). El handshake
 * HTTP lo permite {@link SecurityConfig} porque no lleva el Bearer; el token
 * viaja en el frame STOMP {@code CONNECT}, que el interceptor valida.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;

    /**
     * Origenes del handshake WebSocket, la misma lista que CORS usa para el
     * REST ({@code nexovital.origenes-permitidos}): el front de desarrollo en
     * local y, en despliegues reales, el dominio que se fije por variable de
     * entorno.
     */
    private final String[] origenesPermitidos;

    public WebSocketConfig(StompAuthChannelInterceptor stompAuthChannelInterceptor,
                           @Value("${nexovital.origenes-permitidos:http://localhost:5173,http://127.0.0.1:5173}")
                           String origenesPermitidosCsv) {
        this.stompAuthChannelInterceptor = stompAuthChannelInterceptor;
        this.origenesPermitidos = Arrays.stream(origenesPermitidosCsv.split(","))
                .map(String::trim)
                .filter(origen -> !origen.isEmpty())
                .toArray(String[]::new);
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(origenesPermitidos)
                .withSockJS();
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        // Preserve the PUBLISH order when delivering to every session. Without this
        // the simple broker keeps the default `false` and its outbound channel is
        // asynchronous per thread, so two events published in order can reach a
        // client INVERTED. Con actualizaciones concurrentes el cliente se queda con
        // el estado PERDEDOR mientras la base tiene el GANADOR, que es justo lo que
        // prohibe "un unico estado final para todos" (EP-02.F1.US4, AC2).
        // Reproducido por EmergenciaConvergenciaTest antes de este cambio.
        registry.setPreservePublishOrder(true);
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }
}
