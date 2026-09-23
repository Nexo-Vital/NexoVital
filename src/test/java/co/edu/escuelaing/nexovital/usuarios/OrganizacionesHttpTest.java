package co.edu.escuelaing.nexovital.usuarios;

import co.edu.escuelaing.nexovital.infrastructure.config.DataSeeder;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaRepository;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-level cases of {@code GET /api/v1/organizaciones}: the route declared in
 * the contract, protected by the security chain, returning the seeded centers.
 *
 * <p>Follows the house pattern: real login for the token, {@code test} profile
 * (H2 + seeding), and the controlled clock.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class OrganizacionesHttpTest extends LoginTestBase {

    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** Catalog seeded in {@link DataSeeder}: the 3 Bogotá centers of the front. */
    private static final int ORGANIZACIONES_SEMBRADAS = 3;

    private static final double DELTA = 0.0000001d;

    @Autowired
    private DataSeeder dataSeeder;

    @Autowired
    private OrganizacionJpaRepository organizacionJpaRepository;

    // -----------------------------------------------------------------------
    // 200 with a real token
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /organizaciones with token: 200 and the 3 seeded centers with their location")
    void t1_conToken_devuelveLasOrganizacionesSembradas() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        MvcResult resultado = mockMvc.perform(get("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode arreglo = objectMapper.readTree(resultado.getResponse().getContentAsString());
        assertEquals(ORGANIZACIONES_SEMBRADAS, arreglo.size(),
                "the response must carry the 3 seeded centers");

        Map<String, JsonNode> porNombre = new HashMap<>();
        arreglo.forEach(nodo -> porNombre.put(nodo.get("nombre").asText(), nodo));

        // Names and coordinates are reused literally from the front fixtures.
        assertCentro(porNombre, "Acopio Suba Norte", 4.742d, -74.09d);
        assertCentro(porNombre, "Acopio La Gaitana", 4.72d, -74.05d);
        assertCentro(porNombre, "Acopio Tibabuyes", 4.73d, -74.1d);
    }

    // -----------------------------------------------------------------------
    // 401 without a token: the route is declared, not denied by default
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /organizaciones without token: 401 NO_AUTENTICADO (not a silent default deny)")
    void t2_sinToken_devuelve401() throws Exception {
        mockMvc.perform(get("/api/v1/organizaciones"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("GET /organizaciones with an invalid token: 401")
    void t3_tokenInvalido_devuelve401() throws Exception {
        mockMvc.perform(get("/api/v1/organizaciones")
                        .header("Authorization", "Bearer token-invalido"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // Optional tipo filter
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /organizaciones?tipo= filters by type")
    void t4_filtroPorTipo() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(get("/api/v1/organizaciones")
                        .param("tipo", "CENTRO_ACOPIO")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(ORGANIZACIONES_SEMBRADAS));

        mockMvc.perform(get("/api/v1/organizaciones")
                        .param("tipo", "CENTRO_AYUDA")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("GET /organizaciones?tipo=UNKNOWN: 400 TIPO_INVALIDO through the error envelope")
    void t5_tipoInvalido_devuelve400() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(get("/api/v1/organizaciones")
                        .param("tipo", "NO_EXISTE")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("TIPO_INVALIDO"));
    }

    // -----------------------------------------------------------------------
    // Seeding is idempotent for organizations too
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Re-running the seeder does not duplicate organizations: the count stays at 3")
    void t6_elSeedDeOrganizacionesEsIdempotente() {
        assertEquals(ORGANIZACIONES_SEMBRADAS, organizacionJpaRepository.count(),
                "startup must seed exactly the 3 centers");

        assertDoesNotThrow(() -> dataSeeder.run(), "re-running the seeder must not fail");
        assertEquals(ORGANIZACIONES_SEMBRADAS, organizacionJpaRepository.count(),
                "the second seeder run must insert 0 organizations");

        assertDoesNotThrow(() -> dataSeeder.run(), "a third seeder run must not fail");
        assertEquals(ORGANIZACIONES_SEMBRADAS, organizacionJpaRepository.count(),
                "the third seeder run must still insert 0 organizations");
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

    private static void assertCentro(Map<String, JsonNode> porNombre, String nombre, double lat, double lng) {
        JsonNode centro = porNombre.get(nombre);
        assertNotNull(centro, "the seeded center must be present: " + nombre);

        assertDoesNotThrow(() -> UUID.fromString(centro.get("id").asText()),
                "id must be a UUID: " + nombre);
        assertEquals("CENTRO_ACOPIO", centro.get("tipo").asText(),
                "the 3 seeded centers are acopio centers: " + nombre);
        assertEquals("Suba", centro.get("zonaId").asText(),
                "the seeded centers belong to the Suba locality: " + nombre);
        assertEquals(lat, centro.get("ubicacion").get("lat").asDouble(), DELTA,
                "lat must match the front fixture: " + nombre);
        assertEquals(lng, centro.get("ubicacion").get("lng").asDouble(), DELTA,
                "lng must match the front fixture: " + nombre);
    }
}
