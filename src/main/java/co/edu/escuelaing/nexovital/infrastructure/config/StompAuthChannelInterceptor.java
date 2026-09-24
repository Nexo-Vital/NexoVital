package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.AuthenticationUseCase;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Autorización del canal STOMP (diseño US2 D7). El handshake HTTP no lleva el
 * Bearer, así que permitir {@code /ws/**} no autentica nada: la autenticación
 * real ocurre aquí, en el frame {@code CONNECT}.
 *
 * <ul>
 *   <li>{@code CONNECT}: exige {@code Authorization: Bearer <jwt>}; valida con el
 *       {@link AuthenticationUseCase#validarToken(String)} ya existente (la misma
 *       lógica que usa {@link JwtAuthFilter}), publica el {@code Principal} y la
 *       autoridad {@code ROLE_<ROL>} en la sesión STOMP y RECHAZA el frame si el
 *       token falta o es inválido.</li>
 *   <li>{@code SUBSCRIBE}: exige una sesión autenticada.</li>
 * </ul>
 *
 * <p>No se usa {@code @PreAuthorize}: el repositorio no tiene
 * {@code @EnableMethodSecurity} y la anotación no se evaluaría. Toda la
 * autorización vive en {@link SecurityConfig} (HTTP) y en este interceptor
 * (STOMP).
 */
@Component
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final String PREFIJO_BEARER = "Bearer ";
    private static final String CABECERA_AUTHORIZATION = "Authorization";

    private final AuthenticationUseCase authenticationUseCase;

    public StompAuthChannelInterceptor(AuthenticationUseCase authenticationUseCase) {
        this.authenticationUseCase = authenticationUseCase;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }
        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            autenticar(accessor);
        } else if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            exigirSesionAutenticada(accessor);
        }
        return message;
    }

    /**
     * Valida el Bearer del CONNECT y publica el Principal con su autoridad.
     *
     * @throws AccessDeniedException si el token falta o no es válido
     */
    private void autenticar(StompHeaderAccessor accessor) {
        String header = accessor.getFirstNativeHeader(CABECERA_AUTHORIZATION);
        if (header == null || !header.startsWith(PREFIJO_BEARER)) {
            throw new AccessDeniedException("El CONNECT STOMP exige Authorization: Bearer <jwt>.");
        }
        String token = header.substring(PREFIJO_BEARER.length());
        Usuario usuario;
        try {
            usuario = authenticationUseCase.validarToken(token);
        } catch (CredencialesInvalidasException | UsuarioNoEncontradoException e) {
            throw new AccessDeniedException("Token inválido para el CONNECT STOMP.", e);
        }
        var authentication = new UsernamePasswordAuthenticationToken(
                usuario,
                null,
                List.of(new SimpleGrantedAuthority("ROLE_" + usuario.getRol().name())));
        accessor.setUser(authentication);
    }

    /**
     * @throws AccessDeniedException si el frame SUBSCRIBE no trae una sesión
     *         autenticada (defensa en profundidad: un CONNECT sin token ya fue
     *         rechazado)
     */
    private void exigirSesionAutenticada(StompHeaderAccessor accessor) {
        if (accessor.getUser() == null) {
            throw new AccessDeniedException("El SUBSCRIBE STOMP exige una sesión autenticada.");
        }
    }
}
