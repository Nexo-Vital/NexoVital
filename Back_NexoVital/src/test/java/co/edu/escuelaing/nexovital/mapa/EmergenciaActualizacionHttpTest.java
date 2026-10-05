package co.edu.escuelaing.nexovital.mapa;

import co.edu.escuelaing.nexovital.mapa.application.usecase.EmergenciaPushListener;
import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-level cases of {@code PATCH /api/v1/emergencias/{id}} (US4,
 * {@code updateEmergencia}): the help-center administrator corrects the state
 * and/or the level of a report.
 *
 * <p>Follows the house pattern: real login for the token, {@code test} profile
 * (H2 + seeding), the controlled clock, and — for the emission case — the
 * {@link PushPortDePrueba} double that captures each publication, exactly as
 * {@code OrganizacionEmisionTest} does. The double makes the destination and
 * payload assertions deterministic, without a real STOMP session.
 *
 * <p>This class imports {@link PushPortDePruebaConfig} for the emission case;
 * the other cases are indifferent to which {@code PushPort} is installed.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class EmergenciaActualizacionHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    /** ADMIN_CENTRO_AYUDA: the role the story fixes for the PATCH (D3). */
    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    private static final double DELTA = 0.0000001d;

    /** A point inside the seeded Suba polygon. */
    private static final double SUBA_LAT = 4.73d;
    private static final double SUBA_LNG = -74.08d;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    @AfterEach
    void limpiarPublicaciones() {
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // 200 updating only estado: the level and the rest stay untouched
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH solo estado: 200 con el estado nuevo y el resto de campos intacto")
    void actualizarSoloEstado() throws Exception {
        JsonNode original = crearEmergencia("Corregir solo el estado");
        String id = original.get("id").asText();
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        MvcResult resultado = parchear(token, id, "{\"estado\":\"EN_ATENCION\"}")
                .andExpect(status().isOk())
                .andReturn();
        JsonNode actualizada = objectMapper.readTree(resultado.getResponse().getContentAsString());

        assertEquals("EN_ATENCION", actualizada.get("estado").asText(),
                "el estado devuelto debe ser el nuevo");
        assertEquals(original.get("nivel").asText(), actualizada.get("nivel").asText(),
                "el nivel no venía en el PATCH y no debe cambiar");
        assertCamposInmutables(original, actualizada);
    }

    // -----------------------------------------------------------------------
    // 200 updating only nivel: the state and the rest stay untouched
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH solo nivel: 200 con el nivel nuevo y el resto de campos intacto")
    void actualizarSoloNivel() throws Exception {
        JsonNode original = crearEmergencia("Corregir solo el nivel");
        String id = original.get("id").asText();
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        MvcResult resultado = parchear(token, id, "{\"nivel\":\"CRITICO\"}")
                .andExpect(status().isOk())
                .andReturn();
        JsonNode actualizada = objectMapper.readTree(resultado.getResponse().getContentAsString());

        assertEquals("CRITICO", actualizada.get("nivel").asText(),
                "el nivel devuelto debe ser el nuevo");
        assertEquals(original.get("estado").asText(), actualizada.get("estado").asText(),
                "el estado no venía en el PATCH y no debe cambiar");
        assertCamposInmutables(original, actualizada);
    }

    // -----------------------------------------------------------------------
    // 200 updating both fields at once
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH estado y nivel: 200 con los dos campos nuevos y el resto intacto")
    void actualizarEstadoYNivel() throws Exception {
        JsonNode original = crearEmergencia("Corregir estado y nivel");
        String id = original.get("id").asText();
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        MvcResult resultado = parchear(token, id, "{\"estado\":\"RESUELTA\",\"nivel\":\"BAJO\"}")
                .andExpect(status().isOk())
                .andReturn();
        JsonNode actualizada = objectMapper.readTree(resultado.getResponse().getContentAsString());

        assertEquals("RESUELTA", actualizada.get("estado").asText());
        assertEquals("BAJO", actualizada.get("nivel").asText());
        assertCamposInmutables(original, actualizada);
    }

    // -----------------------------------------------------------------------
    // 404 with a non-existent id, with the envelope (D7)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH con id inexistente: 404 EMERGENCIA_NO_ENCONTRADA con envelope")
    void idInexistenteDevuelve404() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        parchear(token, UUID.randomUUID().toString(), "{\"estado\":\"RESUELTA\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("EMERGENCIA_NO_ENCONTRADA"))
                .andExpect(jsonPath("$.mensaje").exists());
    }

    // -----------------------------------------------------------------------
    // 400 with an empty body: nothing to update (D2)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH con cuerpo vacío {}: 400 DATOS_INVALIDOS")
    void cuerpoVacioDevuelve400() throws Exception {
        String id = crearEmergencia("Cuerpo vacío").get("id").asText();
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        parchear(token, id, "{}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // 400 with a value outside the contract, for either field
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH con estado o nivel fuera del contrato: 400 DATOS_INVALIDOS")
    void valorFueraDelContratoDevuelve400() throws Exception {
        String id = crearEmergencia("Valor fuera del contrato").get("id").asText();
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        parchear(token, id, "{\"estado\":\"INVENTADO\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        parchear(token, id, "{\"nivel\":\"INVENTADO\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // 401 without a token: declared, not denied by default
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH sin token: 401 NO_AUTENTICADO")
    void sinTokenDevuelve401() throws Exception {
        String id = crearEmergencia("Sin token").get("id").asText();

        mockMvc.perform(patch("/api/v1/emergencias/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"estado\":\"RESUELTA\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // 403 with a non-authorized role: only ROLE_ADMIN_CENTRO_AYUDA may patch
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH con rol no autorizado (CIUDADANO): 403 ACCESO_DENEGADO")
    void rolNoAutorizadoDevuelve403() throws Exception {
        String id = crearEmergencia("Rol no autorizado").get("id").asText();
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        parchear(token, id, "{\"estado\":\"RESUELTA\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    // -----------------------------------------------------------------------
    // Current (unfixed) behavior of a non-UUID id: Spring rejects it before the
    // method, so it does NOT go through the module envelope. This pins the
    // declared debt (same as the POST) instead of hiding it.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH con id que no es UUID: 400 de Spring, sin el envelope del módulo (deuda declarada)")
    void idNoUuidDevuelve400DeSpring() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        MvcResult resultado = mockMvc.perform(patch("/api/v1/emergencias/no-es-un-uuid")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"estado\":\"RESUELTA\"}"))
                .andExpect(status().isBadRequest())
                .andReturn();

        String cuerpo = resultado.getResponse().getContentAsString();
        assertFalse(cuerpo.contains("EMERGENCIA_NO_ENCONTRADA"),
                "el id inválido lo resuelve Spring antes del método: no pasa por el envelope del módulo");
    }

    // -----------------------------------------------------------------------
    // Emission: the PATCH publishes the UPDATED payload to /topic/emergencias
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PATCH publica el evento actualizado en /topic/emergencias tras el commit")
    void patchPublicaElEventoActualizado() throws Exception {
        JsonNode original = crearEmergencia("Emitir la actualización");
        String id = original.get("id").asText();
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        // El POST ya publicó su propio evento; se descarta para aislar el del PATCH.
        pushPortDePrueba.limpiar();

        parchear(token, id, "{\"estado\":\"EN_ATENCION\",\"nivel\":\"CRITICO\"}")
                .andExpect(status().isOk());

        // El AFTER_COMMIT es real: con la transacción ya cerrada, el doble debe
        // haber capturado exactamente una publicación, y hacia el destino del contrato.
        List<PublicacionCapturada> publicaciones = pushPortDePrueba.publicaciones();
        assertEquals(1, publicaciones.size(),
                "el PATCH debe emitir exactamente una publicación");
        PublicacionCapturada publicacion = publicaciones.get(0);
        assertEquals("/topic/emergencias", publicacion.destino(),
                "el PATCH emite a /topic/emergencias, el canal que el front consume (D5)");

        // El payload es el agregado con los datos YA actualizados (misma forma que el POST).
        assertNotNull(publicacion.payload(), "el payload no puede ser nulo");
        Emergencia emitida = (Emergencia) publicacion.payload();
        assertEquals(id, emitida.getId().toString());
        assertEquals(EstadoEmergencia.EN_ATENCION, emitida.getEstado(),
                "el evento debe llevar el estado NUEVO, no el anterior");
        assertEquals(NivelEmergencia.CRITICO, emitida.getNivel(),
                "el evento debe llevar el nivel NUEVO, no el anterior");
        assertEquals(original.get("descripcion").asText(), emitida.getDescripcion());
        assertEquals(SUBA_LAT, emitida.getUbicacion().lat(), DELTA);
        assertEquals(SUBA_LNG, emitida.getUbicacion().lng(), DELTA);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Reports an emergency as CIUDADANO and returns the created body. */
    private JsonNode crearEmergencia(String descripcion) throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        MvcResult alta = mockMvc.perform(post("/api/v1/emergencias")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "ubicacion", Map.of("lat", SUBA_LAT, "lng", SUBA_LNG),
                                "tipo", "INUNDACION",
                                "nivel", "BAJO",
                                "descripcion", descripcion))))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readTree(alta.getResponse().getContentAsString());
    }

    /** PATCHes the emergency with the given raw JSON body. */
    private ResultActions parchear(String token, String id, String cuerpo) throws Exception {
        return mockMvc.perform(patch("/api/v1/emergencias/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(cuerpo));
    }

    /**
     * Asserts that the PATCH does NOT change the fields the contract does not
     * admit: {@code id}, {@code ubicacion}, {@code descripcion},
     * {@code zonaId} and {@code createdAt} must equal the POST response.
     */
    private static void assertCamposInmutables(JsonNode original, JsonNode actualizada) {
        assertEquals(original.get("id").asText(), actualizada.get("id").asText(), "el id no cambia");
        assertEquals(original.get("descripcion").asText(), actualizada.get("descripcion").asText(),
                "la descripcion no viaja en el PATCH y no debe cambiar");
        assertEquals(original.get("tipo").asText(), actualizada.get("tipo").asText(),
                "el tipo se fija al reportar y el PATCH no lo cambia");
        assertEquals(original.get("createdAt").asText(), actualizada.get("createdAt").asText(),
                "createdAt no se reestampa al actualizar");
        assertEquals(original.get("ubicacion").get("lat").asDouble(),
                actualizada.get("ubicacion").get("lat").asDouble(), DELTA,
                "la ubicacion no viaja en el PATCH (moverla cambiaría su zona, D1)");
        assertEquals(original.get("ubicacion").get("lng").asDouble(),
                actualizada.get("ubicacion").get("lng").asDouble(), DELTA,
                "la ubicacion no viaja en el PATCH (moverla cambiaría su zona, D1)");
        assertEquals(original.get("zonaId").asText(), actualizada.get("zonaId").asText(),
                "la zona derivada del punto no debe cambiar");
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
