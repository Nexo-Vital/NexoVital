package co.edu.escuelaing.nexovital.mapa;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
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

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-level cases of {@code POST /api/v1/emergencias}: the route declared in the
 * contract, protected by the security chain with {@code ROLE_CIUDADANO}, which
 * registers a report and resolves its zone from the point.
 *
 * <p>Follows the house pattern: real login for the token, {@code test} profile
 * (H2 + seeding), and the controlled clock.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class EmergenciasHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    /** ADMIN_CENTRO_AYUDA: authenticated but NOT authorized for this route. */
    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    private static final double DELTA = 0.0000001d;

    /** A point inside the seeded Suba polygon (design T2). */
    private static final double SUBA_LAT = 4.73d;
    private static final double SUBA_LNG = -74.08d;

    /** A point far outside every seeded Bogotá polygon (design T3). */
    private static final double FUERA_LAT = 10.0d;
    private static final double FUERA_LNG = -75.0d;

    // -----------------------------------------------------------------------
    // 201 with a real token: server fields and the zone resolved from the point
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias as CIUDADANO: 201, server fields and the zone resolved to Suba")
    void t1_ciudadanoReporta_devuelve201ConZonaResuelta() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        MvcResult resultado = mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", "Incendio en bodega")))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode emergencia = objectMapper.readTree(resultado.getResponse().getContentAsString());

        assertDoesNotThrow(() -> UUID.fromString(emergencia.get("id").asText()),
                "the server must assign a UUID id");
        assertEquals("ALTO", emergencia.get("nivel").asText());
        assertEquals("REGISTRADA", emergencia.get("estado").asText(),
                "a new emergency is born REGISTRADA (server-assigned)");
        assertEquals("Incendio en bodega", emergencia.get("descripcion").asText());
        assertEquals(SUBA_LAT, emergencia.get("ubicacion").get("lat").asDouble(), DELTA);
        assertEquals(SUBA_LNG, emergencia.get("ubicacion").get("lng").asDouble(), DELTA);
        assertTrue(emergencia.hasNonNull("createdAt"), "the server must stamp createdAt");
        assertEquals("Suba", emergencia.get("zonaId").asText(),
                "the point falls inside the seeded Suba polygon (design D4)");
    }

    // -----------------------------------------------------------------------
    // A point outside every seeded zone is accepted with zonaId null (D4)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias with a point outside every zone: 201 with zonaId null")
    void t2_puntoFueraDeTodaZona_zonaIdNulo() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        MvcResult resultado = mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(FUERA_LAT, FUERA_LNG, "BAJO", "Reporte fuera del catálogo")))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode emergencia = objectMapper.readTree(resultado.getResponse().getContentAsString());
        assertEquals("REGISTRADA", emergencia.get("estado").asText());
        assertTrue(emergencia.get("zonaId").isNull(),
                "a point outside every seeded zone is accepted with zonaId null (design D4)");
    }

    // -----------------------------------------------------------------------
    // 401 without a token: the route is declared, not denied by default
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias without token: 401 NO_AUTENTICADO (not a silent default deny)")
    void t3_sinToken_devuelve401() throws Exception {
        mockMvc.perform(post("/api/v1/emergencias")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", "Sin token")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // 403 with a non-authorized role: only ROLE_CIUDADANO may report
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias with a non-authorized role: 403 ACCESO_DENEGADO")
    void t4_rolNoAutorizado_devuelve403() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", "Rol no autorizado")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    // -----------------------------------------------------------------------
    // Design T4: a missing required field is rejected with the error envelope
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias without nivel: 400 DATOS_INVALIDOS")
    void t5_sinNivel_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSin("nivel")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    @Test
    @DisplayName("POST /emergencias without ubicacion: 400 DATOS_INVALIDOS")
    void t6_sinUbicacion_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSin("ubicacion")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    /**
     * {@code descripcion} is not checked by the controller: the use case rejects
     * a blank one. This pins that the 400 still comes out through the envelope.
     */
    @Test
    @DisplayName("POST /emergencias without descripcion: 400 DATOS_INVALIDOS")
    void t7_sinDescripcion_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSin("descripcion")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    @Test
    @DisplayName("POST /emergencias with an unknown nivel: 400 DATOS_INVALIDOS")
    void t8_nivelDesconocido_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "EXTREMO", "Nivel fuera del contrato")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // Design T5: a latitude outside the range is rejected (AC2)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias with lat 200: 400 DATOS_INVALIDOS")
    void t9_latFueraDeRango_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(200.0d, SUBA_LNG, "ALTO", "Latitud imposible")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // Design T8: the report stays visible over REST, and the route is declared
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /emergencias after a POST: 200 and the list contains the report; without token 401")
    void t10_listarEmergenciasIncluyeElReporteYExigeToken() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        MvcResult alta = mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", "Reporte visible por REST")))
                .andExpect(status().isCreated())
                .andReturn();
        String id = objectMapper.readTree(alta.getResponse().getContentAsString()).get("id").asText();

        MvcResult listado = mockMvc.perform(get("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode emergencias = objectMapper.readTree(listado.getResponse().getContentAsString());
        assertTrue(emergencias.isArray(), "the GET must return a JSON list");

        // Membership, not position: other tests may have left reports in the
        // shared H2 database, so the new one is searched for by id.
        boolean contieneElReporte = false;
        for (JsonNode emergencia : emergencias) {
            if (id.equals(emergencia.get("id").asText())) {
                contieneElReporte = true;
                break;
            }
        }
        assertTrue(contieneElReporte, "the list must contain the report just created: " + id);

        // The route is declared, not denied by default: without a token it must
        // be 401 (NOT_AUTHENTICATED), not 403 (ACCESS_DENIED).
        mockMvc.perform(get("/api/v1/emergencias"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Logs in with real credentials and returns the issued token. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }

    private String cuerpo(double lat, double lng, String nivel, String descripcion) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "ubicacion", Map.of("lat", lat, "lng", lng),
                "nivel", nivel,
                "descripcion", descripcion));
    }

    /**
     * A well-formed body with ONE required field removed, to prove the missing
     * field is what triggers the rejection.
     */
    private String cuerpoSin(String campoOmitido) throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("ubicacion", Map.of("lat", SUBA_LAT, "lng", SUBA_LNG));
        cuerpo.put("nivel", "ALTO");
        cuerpo.put("descripcion", "Reporte con un campo omitido");
        cuerpo.remove(campoOmitido);
        return objectMapper.writeValueAsString(cuerpo);
    }
}
