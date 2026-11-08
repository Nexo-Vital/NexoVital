package co.edu.escuelaing.nexovital.flota;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import co.edu.escuelaing.nexovital.infrastructure.config.RegistroAccesoDenegado;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaEntity;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.Arrays;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sprint 2, T11 at the HTTP boundary: the two ways a request is refused (wrong
 * role and someone else's resource) must reach {@link RegistroAccesoDenegado}.
 * The unit test pins the format; these tests pin that every 403 path is wired.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class AccesoDenegadoRegistroHttpTest extends SolicitudHttpTestSupport {

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
    @DisplayName("T11: el 403 por rol insuficiente queda registrado")
    void el403PorRolInsuficienteQuedaRegistrado() throws Exception {
        String ciudadano = tokenCiudadano();

        mockMvc.perform(get("/api/v1/auditoria/emergencias/{id}", UUID.randomUUID())
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isForbidden());

        assertTrue(hayEvento("motivo=rol_insuficiente", "ruta=/api/v1/auditoria/emergencias/"),
                "el rechazo por rol debe quedar en la bitácora de accesos denegados");
    }

    @Test
    @DisplayName("T11: el 403 por recurso ajeno queda registrado con el actor que lo intentó")
    void el403PorRecursoAjenoQuedaRegistrado() throws Exception {
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));

        String emailAjeno = "ajeno-" + UUID.randomUUID() + "@nexovital.co";
        UUID ajenoId = UUID.randomUUID();
        usuarioJpaRepository.save(new UsuarioJpaEntity(
                ajenoId, "Ciudadano Ajeno", emailAjeno,
                passwordEncoderPort.encriptar("ajeno123"), RolUsuario.CIUDADANO));
        try {
            String ajeno = tokenDe(emailAjeno, "ajeno123");

            mockMvc.perform(post("/api/v1/solicitudes/{id}/cancelar", solicitudId)
                            .header("Authorization", "Bearer " + ajeno))
                    .andExpect(status().isForbidden());

            assertTrue(hayEvento(
                            "actor=" + ajenoId,
                            "motivo=recurso_ajeno",
                            "ruta=/api/v1/solicitudes/" + solicitudId + "/cancelar"),
                    "el rechazo por pertenencia debe quedar registrado con el actor real");
        } finally {
            usuarioJpaRepository.deleteById(ajenoId);
        }
    }

    private boolean hayEvento(String... fragmentos) {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .anyMatch(mensaje -> Arrays.stream(fragmentos).allMatch(mensaje::contains));
    }
}
