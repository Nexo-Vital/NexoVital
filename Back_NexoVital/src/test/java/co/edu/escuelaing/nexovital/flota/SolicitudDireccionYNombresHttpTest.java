package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Refinements, lote C: readable address of a request and the names of citizen and driver. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudDireccionYNombresHttpTest extends SolicitudHttpTestSupport {

    private static final String DIRECCION = "Calle 145 # 91-19, Suba, Bogotá";
    private static final String NOMBRE_CIUDADANO = "Ana Gómez";
    private static final String NOMBRE_CONDUCTOR = "Conductor de prueba";

    private final List<UUID> propias = new ArrayList<>();

    @AfterEach
    void borrarSolicitudesPropias() {
        solicitudJpaRepository.deleteAllById(propias);
        propias.clear();
    }

    private ResultActions solicitarCon(String token, String direccion) throws Exception {
        return mockMvc.perform(post("/api/v1/solicitudes")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "ubicacion", Map.of("lat", 4.73d, "lng", -74.08d),
                        "zonaId", zona,
                        "direccion", direccion))));
    }

    private JsonNode crearCon(String token, String direccion) throws Exception {
        MvcResult result = solicitarCon(token, direccion).andExpect(status().isCreated()).andReturn();
        JsonNode creada = objectMapper.readTree(result.getResponse().getContentAsString());
        propias.add(UUID.fromString(creada.get("id").asText()));
        return creada;
    }

    private static boolean esNulo(JsonNode nodo, String campo) {
        return nodo.get(campo) == null || nodo.get(campo).isNull();
    }

    @Test
    @DisplayName("D1: la dirección y el nombre del ciudadano viajan en la respuesta y en el aviso al conductor")
    void direccionYNombreEnRespuestaYPush() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);

        JsonNode creada = crearCon(tokenCiudadano(), "  " + DIRECCION + "  ");

        assertEquals(DIRECCION, creada.get("direccion").asText(), "se guarda sin espacios sobrantes");
        assertEquals(NOMBRE_CIUDADANO, creada.get("solicitanteNombre").asText());
        List<SolicitudPushPayload> frames = framesDe(conductor, idDe(creada), "PENDIENTE");
        assertFalse(frames.isEmpty(), "el conductor avisado recibe la solicitud");
        assertEquals(DIRECCION, frames.get(0).direccion());
        assertEquals(NOMBRE_CIUDADANO, frames.get(0).solicitanteNombre());
    }

    @Test
    @DisplayName("D2: Mis solicitudes y el detalle del conductor leen la dirección guardada")
    void lecturasMuestranDireccion() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();
        UUID id = idDe(crearCon(ciudadano, DIRECCION));

        MvcResult mias = mockMvc.perform(get("/api/v1/solicitudes/mias")
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isOk())
                .andReturn();
        boolean encontrada = false;
        for (JsonNode solicitud : objectMapper.readTree(mias.getResponse().getContentAsString())) {
            if (id.toString().equals(solicitud.get("id").asText())) {
                encontrada = true;
                assertEquals(DIRECCION, solicitud.get("direccion").asText());
            }
        }
        assertTrue(encontrada, "la solicitud activa aparece en Mis solicitudes");

        mockMvc.perform(get("/api/v1/solicitudes/{id}", id)
                        .header("Authorization", "Bearer " + tokenDe(conductor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.direccion").value(DIRECCION))
                .andExpect(jsonPath("$.solicitanteNombre").value(NOMBRE_CIUDADANO));
    }

    @Test
    @DisplayName("D3: una dirección vacía se guarda como ausente; una de más de 255 caracteres es 400")
    void direccionVaciaOLarga() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();

        JsonNode sinDireccion = crearCon(ciudadano, "   ");
        assertTrue(esNulo(sinDireccion, "direccion"), "una dirección en blanco no se guarda");

        solicitarCon(ciudadano, "x".repeat(256))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    @Test
    @DisplayName("D4: la flota y la unidad propia exponen el nombre del conductor")
    void flotaExponeNombreDelConductor() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);

        MvcResult flota = mockMvc.perform(get("/api/v1/flota/ambulancias")
                        .header("Authorization", "Bearer " + tokenCiudadano()))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode unidad = null;
        for (JsonNode ambulancia : objectMapper.readTree(flota.getResponse().getContentAsString())) {
            if (conductor.unidad().toString().equals(ambulancia.get("id").asText())) {
                unidad = ambulancia;
            }
        }
        assertNotNull(unidad, "la unidad sembrada aparece en la flota");
        assertEquals(NOMBRE_CONDUCTOR, unidad.get("conductorNombre").asText());

        mockMvc.perform(get("/api/v1/flota/ambulancias/mia")
                        .header("Authorization", "Bearer " + tokenDe(conductor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conductorNombre").value(NOMBRE_CONDUCTOR));
    }
}
