package co.edu.escuelaing.nexovital.flota;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;

import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sprint 2, T11 at the HTTP boundary: the two ways a request is refused (wrong
 * role and someone else's resource) must reach {@link RegistroAccesoDenegado}.
 * The unit test pins the format; these tests pin that every 403 path is wired.
 *
 * <p>T12 adds the driver's side of S-4 ("un conductor intenta modificar una
 * ambulancia que no es suya") on the four request actions, and S-1 adds the
 * 401s: a request without a valid token is refused AND logged.
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

    @Test
    @DisplayName("T10-T12: un conductor que usa la unidad de otro recibe 403 en accept, reject, llegada y finalizar, queda registrado y no cambia nada")
    void conductorConUnidadAjenaRecibe403EnLasCuatroAcciones() throws Exception {
        Conductor intruso = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor duenio = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenIntruso = tokenDe(intruso);
        String tokenDuenio = tokenDe(duenio);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));

        // accept y reject con la unidad del otro, con la solicitud PENDIENTE.
        conUnidadDe(duenio, "accept", solicitudId, tokenIntruso);
        conUnidadDe(duenio, "reject", solicitudId, tokenIntruso);
        assertEquals(EstadoSolicitud.PENDIENTE, solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado(),
                "el intento ajeno no asigna la solicitud");
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(duenio.unidad()).getEstado(),
                "el intento ajeno no ocupa la unidad");

        // El dueño sí puede aceptar: el reject ajeno no dejó un rechazo a su nombre.
        responder("accept", solicitudId, duenio, tokenDuenio).andExpect(status().isOk());

        // llegada con la unidad del otro, con la solicitud ASIGNADA.
        conUnidadDe(duenio, "llegada", solicitudId, tokenIntruso);
        assertNull(solicitudJpaRepository.findById(solicitudId).orElseThrow().getLlegadaEn(),
                "el intento ajeno no registra la llegada");

        // finalizar con la unidad del otro, con llegada declarada y confirmada.
        responder("llegada", solicitudId, duenio, tokenDuenio).andExpect(status().isOk());
        confirmarLlegada(solicitudId, ciudadano).andExpect(status().isOk());
        EstadoSolicitud antes = solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado();
        conUnidadDe(duenio, "finalizar", solicitudId, tokenIntruso);
        assertEquals(antes, solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado(),
                "el intento ajeno no cierra el servicio");
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(duenio.unidad()).getEstado(),
                "el intento ajeno no libera la unidad");

        for (String accion : new String[] {"accept", "reject", "llegada", "finalizar"}) {
            assertTrue(hayEvento(
                            "actor=" + intruso.id(),
                            "motivo=recurso_ajeno",
                            "ruta=/api/v1/solicitudes/" + solicitudId + "/" + accion),
                    "el 403 de " + accion + " debe quedar registrado con el actor real");
        }
    }

    @Test
    @DisplayName("S-1 / T11: una petición sin token responde 401 y queda registrada como token_ausente")
    void el401SinTokenQuedaRegistrado() throws Exception {
        mockMvc.perform(get("/api/v1/solicitudes/mias"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));

        assertTrue(hayEvento("autenticacion_fallida", "canal=http", "metodo=GET",
                        "ruta=/api/v1/solicitudes/mias", "motivo=token_ausente"),
                "el 401 sin token debe quedar registrado");
    }

    @Test
    @DisplayName("S-1 / T11: un token alterado responde 401, queda registrado como token_invalido y el token no se escribe")
    void el401ConTokenInvalidoQuedaRegistradoSinElToken() throws Exception {
        String tokenAlterado = "token-alterado-" + UUID.randomUUID();

        mockMvc.perform(get("/api/v1/solicitudes/mias")
                        .header("Authorization", "Bearer " + tokenAlterado))
                .andExpect(status().isUnauthorized());

        assertTrue(hayEvento("autenticacion_fallida", "canal=http", "motivo=token_invalido"),
                "el 401 con token inválido debe quedar registrado");
        assertFalse(appender.list.stream()
                        .map(ILoggingEvent::getFormattedMessage)
                        .anyMatch(mensaje -> mensaje.contains(tokenAlterado)),
                "el token nunca se escribe en el log");
    }

    /** Ejecuta la acción con la unidad de {@code duenio} y el token de otro: 403 AMBULANCIA_AJENA. */
    private void conUnidadDe(Conductor duenio, String accion, UUID solicitudId, String tokenAjeno) throws Exception {
        mockMvc.perform(post("/api/v1/solicitudes/{id}/" + accion, solicitudId)
                        .header("Authorization", "Bearer " + tokenAjeno)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("ambulanciaId", duenio.unidad().toString()))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("AMBULANCIA_AJENA"));
    }

    private boolean hayEvento(String... fragmentos) {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .anyMatch(mensaje -> Arrays.stream(fragmentos).allMatch(mensaje::contains));
    }
}
