package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Traza completa de una solicitud y de una emergencia (Maintain Audit Trail).
 *
 * <p>El escenario promete "traza completa de una emergencia en menos de 1 s" y
 * que el 100 % de las acciones criticas deje exactamente un registro. Aca se
 * recorre el ciclo real por HTTP — crear, aceptar, declarar llegada, confirmar y
 * finalizar — y se lee la bitacora por su endpoint.
 *
 * <p>Una solicitud creada sin emergencia se audita contra si misma
 * ({@code SOLICITUD}); una que nace de una emergencia cuelga sus eventos de la
 * emergencia, para que su traza sea una sola.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class AuditoriaFlujoHttpTest extends SolicitudHttpTestSupport {

    private static final String ADMIN = "admin@nexovital.co";
    private static final String ADMIN_PASSWORD = "admin123";

    @Test
    @DisplayName("Cada paso del servicio deja un registro en la traza de la solicitud")
    void cadaPasoDelServicioQuedaEnLaTraza() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenConductor = tokenDe(conductor);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));

        responder("accept", solicitudId, conductor, tokenConductor).andExpect(status().isOk());
        responder("llegada", solicitudId, conductor, tokenConductor).andExpect(status().isOk());
        confirmarLlegada(solicitudId, ciudadano).andExpect(status().isOk());
        responder("finalizar", solicitudId, conductor, tokenConductor).andExpect(status().isOk());

        String admin = tokenDe(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(get("/api/v1/auditoria/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[0].accion").value("AMBULANCIA_ASIGNADA"))
                .andExpect(jsonPath("$[1].accion").value("LLEGADA_REPORTADA"))
                .andExpect(jsonPath("$[2].accion").value("LLEGADA_CONFIRMADA"))
                .andExpect(jsonPath("$[3].accion").value("SERVICIO_FINALIZADO"))
                .andExpect(jsonPath("$[0].recursoTipo").value("SOLICITUD"))
                .andExpect(jsonPath("$[0].recursoId").value(solicitudId.toString()))
                .andExpect(jsonPath("$[0].actorId").value(conductor.id().toString()));
    }

    @Test
    @DisplayName("El rechazo del conductor queda en la traza y no cierra la solicitud")
    void elRechazoQuedaEnLaTraza() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenConductor = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("reject", solicitudId, conductor, tokenConductor).andExpect(status().isOk());

        String admin = tokenDe(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(get("/api/v1/auditoria/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].accion").value("SOLICITUD_RECHAZADA"))
                .andExpect(jsonPath("$[0].actorId").value(conductor.id().toString()));
    }

    @Test
    @DisplayName("Reportar una emergencia abre su traza con el solicitante como actor")
    void reportarEmergenciaAbreSuTraza() throws Exception {
        String ciudadano = tokenCiudadano();
        String cuerpo = objectMapper.writeValueAsString(Map.of(
                "ubicacion", Map.of("lat", 4.65d, "lng", -74.05d),
                "tipo", "INUNDACION",
                "nivel", "ALTO",
                "descripcion", "Traza de auditoria del escenario"));

        MvcResult resultado = mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + ciudadano)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode creada = objectMapper.readTree(resultado.getResponse().getContentAsString());
        UUID emergenciaId = UUID.fromString(creada.get("id").asText());

        String admin = tokenDe(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(get("/api/v1/auditoria/emergencias/{id}", emergenciaId)
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].accion").value("EMERGENCIA_REPORTADA"))
                .andExpect(jsonPath("$[0].recursoTipo").value("EMERGENCIA"))
                .andExpect(jsonPath("$[0].recursoId").value(emergenciaId.toString()))
                .andExpect(jsonPath("$[0].actorId").value(usuarioDe(CIUDADANO).getId().toString()));
    }
}
