package co.edu.escuelaing.nexovital.infrastructure.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.access.AccessDeniedException;

import java.util.Arrays;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Sprint 2, S-1 / T11 en el canal en tiempo real: un {@code CONNECT} sin token
 * válido no abre la conexión y deja el intento registrado.
 */
class StompAuthChannelInterceptorTest {

    private static final String TOKEN_VALIDO = "token-valido";
    /** Token válido de Google cuya cuenta todavía no eligió su rol (T10). */
    private static final String TOKEN_SIN_REGISTRO = "token-sin-registro";

    private final Usuario conductor = new Usuario(
            UUID.randomUUID(), "Ana", "ana@nexovital.co", "hash", RolUsuario.CONDUCTOR);
    private final StompAuthChannelInterceptor interceptor = new StompAuthChannelInterceptor(
            token -> {
                if (TOKEN_VALIDO.equals(token)) {
                    return conductor;
                }
                if (TOKEN_SIN_REGISTRO.equals(token)) {
                    throw new UsuarioNoRegistradoException("uid-sin-registro");
                }
                throw new CredencialesInvalidasException();
            },
            new RegistroAccesoDenegado());

    private final Logger logger = (Logger) LoggerFactory.getLogger(RegistroAccesoDenegado.class);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    @BeforeEach
    void engancharElAppender() {
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void soltarElAppender() {
        logger.detachAppender(appender);
    }

    @Test
    @DisplayName("CONNECT sin Authorization: se rechaza y se registra como token_ausente")
    void connectSinTokenSeRechazaYseRegistra() {
        Message<byte[]> connect = frame(StompCommand.CONNECT, null);

        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(connect, null));
        assertTrue(hayEvento("autenticacion_fallida", "canal=stomp", "motivo=token_ausente"));
    }

    @Test
    @DisplayName("CONNECT con un token alterado: se rechaza y se registra como token_invalido")
    void connectConTokenInvalidoSeRechazaYseRegistra() {
        Message<byte[]> connect = frame(StompCommand.CONNECT, "Bearer token-alterado");

        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(connect, null));
        assertTrue(hayEvento("autenticacion_fallida", "canal=stomp", "motivo=token_invalido"));
    }

    @Test
    @DisplayName("CONNECT de una cuenta de Google sin registro: no abre el canal y se registra (T12)")
    void connectDeCuentaSinRegistroSeRechazaYseRegistra() {
        Message<byte[]> connect = frame(StompCommand.CONNECT, "Bearer " + TOKEN_SIN_REGISTRO);

        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(connect, null));
        assertTrue(hayEvento("autenticacion_fallida", "canal=stomp", "motivo=usuario_no_registrado"));
    }

    @Test
    @DisplayName("SUBSCRIBE sin sesión: se rechaza y se registra")
    void subscribeSinSesionSeRechazaYseRegistra() {
        Message<byte[]> subscribe = frame(StompCommand.SUBSCRIBE, null);

        assertThrows(AccessDeniedException.class, () -> interceptor.preSend(subscribe, null));
        assertTrue(hayEvento("autenticacion_fallida", "canal=stomp", "motivo=sesion_no_autenticada"));
    }

    @Test
    @DisplayName("CONNECT con token válido: abre la sesión y no registra nada")
    void connectValidoNoRegistra() {
        Message<byte[]> connect = frame(StompCommand.CONNECT, "Bearer " + TOKEN_VALIDO);

        Message<?> resultado = interceptor.preSend(connect, null);

        assertNotNull(resultado);
        assertTrue(appender.list.isEmpty(), "un CONNECT válido no es un intento fallido");
    }

    private static Message<byte[]> frame(StompCommand comando, String authorization) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(comando);
        if (authorization != null) {
            accessor.addNativeHeader("Authorization", authorization);
        }
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private boolean hayEvento(String... fragmentos) {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .anyMatch(mensaje -> Arrays.stream(fragmentos).allMatch(mensaje::contains));
    }
}
