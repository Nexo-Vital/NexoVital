package co.edu.escuelaing.nexovital.infrastructure.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Sprint 2, T11: a denied attempt must leave a trace with who tried, which
 * method, on which route and why it was refused.
 */
class RegistroAccesoDenegadoTest {

    private final RegistroAccesoDenegado registro = new RegistroAccesoDenegado();
    private final Logger logger = (Logger) LoggerFactory.getLogger(RegistroAccesoDenegado.class);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    @BeforeEach
    void engancharElAppender() {
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void limpiarElContexto() {
        logger.detachAppender(appender);
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void registraActorMetodoRutaYmotivo() {
        UUID actor = UUID.randomUUID();
        autenticar(new Usuario(actor, "Ana", "ana@nexovital.co", "hash", RolUsuario.CONDUCTOR));
        peticion("POST", "/api/v1/solicitudes/123/cancelar");

        registro.registrar("recurso_ajeno");

        assertTrue(hayEvento(
                        "actor=" + actor,
                        "metodo=POST",
                        "ruta=/api/v1/solicitudes/123/cancelar",
                        "motivo=recurso_ajeno"),
                "el intento denegado debe quedar registrado con sus cuatro campos");
    }

    @Test
    void registraAnonimoCuandoLaPeticionNoTraeSesion() {
        peticion("GET", "/api/v1/auditoria/emergencias/123");

        registro.registrar("rol_insuficiente");

        assertTrue(hayEvento(
                        "actor=anonimo",
                        "metodo=GET",
                        "ruta=/api/v1/auditoria/emergencias/123",
                        "motivo=rol_insuficiente"),
                "sin sesión el actor se registra como anonimo, nunca vacío");
    }

    private static void autenticar(Usuario usuario) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(usuario, null, List.of()));
    }

    private static void peticion(String metodo, String ruta) {
        MockHttpServletRequest request = new MockHttpServletRequest(metodo, ruta);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private boolean hayEvento(String... fragmentos) {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .anyMatch(mensaje -> Arrays.stream(fragmentos).allMatch(mensaje::contains));
    }
}
