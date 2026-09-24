package co.edu.escuelaing.nexovital.infrastructure.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

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

    public WebSocketConfig(StompAuthChannelInterceptor stompAuthChannelInterceptor) {
        this.stompAuthChannelInterceptor = stompAuthChannelInterceptor;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("http://localhost:5173", "http://127.0.0.1:5173")
                .withSockJS();
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }
}
