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

import java.time.Duration;
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

    /**
     * ADMIN_CENTRO_AYUDA: shares the citizen screen, so it may report an
     * affected zone too (and read the emergencies, like every role).
     */
    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** ADMIN_PLATAFORMA: authenticated but NOT authorized to report. */
    private static final String NO_AUTORIZADO = "admin@nexovital.co";
    private static final String NO_AUTORIZADO_PASSWORD = "admin123";

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
        assertEquals("INCENDIO", emergencia.get("tipo").asText(),
                "the reported type must come back (EP-02.F1.US3: tipo de emergencia)");
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
    // 403 with a non-authorized role: only the roles that use the citizen
    // screen (CIUDADANO, ADMIN_CENTRO_AYUDA and ADMIN_ACOPIO) may report
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /emergencias with a non-authorized role: 403 ACCESO_DENEGADO")
    void t4_rolNoAutorizado_devuelve403() throws Exception {
        String token = tokenDe(NO_AUTORIZADO, NO_AUTORIZADO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", "Rol no autorizado")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    @Test
    @DisplayName("POST /emergencias as the help-center administrator: 201 (same screen as the citizen)")
    void t4b_adminCentroAyudaPuedeReportar() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", "Reporte del administrador de centro")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty());
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

    /**
     * EP-02.F1.US3: the citizen reports "indicando tipo de emergencia y
     * ubicación", so a report without a type is as invalid as one without a
     * location.
     */
    @Test
    @DisplayName("POST /emergencias without tipo: 400 DATOS_INVALIDOS")
    void t5b_sinTipo_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSin("tipo")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    @Test
    @DisplayName("POST /emergencias with a tipo outside the closed list: 400 DATOS_INVALIDOS")
    void t5c_tipoDesconocido_devuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoConTipo("TORNADO")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    @Test
    @DisplayName("POST /emergencias with every tipo of the closed list: 201 and the same tipo back")
    void t5d_cadaTipoDelCatalogo_devuelve201() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        for (String tipo : new String[] {"INUNDACION", "INCENDIO", "DERRUMBE", "SISMO", "ACCIDENTE", "OTRO"}) {
            mockMvc.perform(post("/api/v1/emergencias")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(cuerpoConTipo(tipo)))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.tipo").value(tipo));
        }
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
    // Design D7: the read model is open to EVERY authenticated role, not only
    // the citizen who reports. This pins that decision.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /emergencias as another authenticated role: 200 (D7 opens it to every role)")
    void t11_listarEmergenciasOtroRolAutenticado() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(get("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    // -----------------------------------------------------------------------
    // The repository orders by createdAt descending; without this case the only
    // new query decision would be untested (a plain findAll() would pass T8).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /emergencias lists the newest report first (createdAt descending)")
    void t12_listarEmergenciasOrdenaLaMasRecientePrimero() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        String idVieja = reportarYDevolverId(token, "Reporte antiguo");
        clock.avanzar(Duration.ofMinutes(5));
        String idNueva = reportarYDevolverId(token, "Reporte reciente");

        MvcResult listado = mockMvc.perform(get("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode emergencias = objectMapper.readTree(listado.getResponse().getContentAsString());
        int posicionNueva = indiceDe(emergencias, idNueva);
        int posicionVieja = indiceDe(emergencias, idVieja);

        assertTrue(posicionNueva >= 0 && posicionVieja >= 0,
                "both reports must be listed");
        assertTrue(posicionNueva < posicionVieja,
                "the newest report must come first: " + idNueva + " before " + idVieja);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Reports and returns the server-assigned id. */
    private String reportarYDevolverId(String token, String descripcion) throws Exception {
        MvcResult alta = mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(SUBA_LAT, SUBA_LNG, "ALTO", descripcion)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(alta.getResponse().getContentAsString()).get("id").asText();
    }

    /** Position of the report with that id in the listed array, or -1. */
    private static int indiceDe(JsonNode emergencias, String id) {
        for (int i = 0; i < emergencias.size(); i++) {
            if (id.equals(emergencias.get(i).get("id").asText())) {
                return i;
            }
        }
        return -1;
    }

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
                "tipo", "INCENDIO",
                "nivel", nivel,
                "descripcion", descripcion));
    }

    /** A well-formed body whose only variable is the emergency type. */
    private String cuerpoConTipo(String tipo) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "ubicacion", Map.of("lat", SUBA_LAT, "lng", SUBA_LNG),
                "tipo", tipo,
                "nivel", "ALTO",
                "descripcion", "Reporte con tipo " + tipo));
    }

    /**
     * A well-formed body with ONE required field removed, to prove the missing
     * field is what triggers the rejection.
     */
    private String cuerpoSin(String campoOmitido) throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("ubicacion", Map.of("lat", SUBA_LAT, "lng", SUBA_LNG));
        cuerpo.put("tipo", "INCENDIO");
        cuerpo.put("nivel", "ALTO");
        cuerpo.put("descripcion", "Reporte con un campo omitido");
        cuerpo.remove(campoOmitido);
        return objectMapper.writeValueAsString(cuerpo);
    }
}
