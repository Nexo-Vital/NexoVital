package co.edu.escuelaing.nexovital.mapa;

import co.edu.escuelaing.nexovital.infrastructure.config.DataSeeder;
import co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out.ZonaJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
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
 * HTTP-level cases of {@code GET /api/v1/mapa}: the route declared in the
 * contract, protected by the security chain, returning the seeded zones and
 * the seeded centers with their location.
 *
 * <p>Follows the house pattern: real login for the token, {@code test} profile
 * (H2 + seeding), and the controlled clock.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class MapaHttpTest extends LoginTestBase {

    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** Catalog seeded in {@link DataSeeder}: the Bogotá localities of the front. */
    private static final int ZONAS_SEMBRADAS = 6;

    /** Catalog seeded in {@link DataSeeder}: the 3 Bogotá centers of the front. */
    private static final int CENTROS_SEMBRADOS = 3;

    private static final double DELTA = 0.0000001d;

    @Autowired
    private DataSeeder dataSeeder;

    @Autowired
    private ZonaJpaRepository zonaJpaRepository;

    // -----------------------------------------------------------------------
    // 200 with a real token: zones + centers with their location
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /mapa with token: 200, the seeded zones and the centers with their location")
    void t1_conToken_devuelveZonasYCentrosConUbicacion() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        MvcResult resultado = mockMvc.perform(get("/api/v1/mapa")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode cuerpo = objectMapper.readTree(resultado.getResponse().getContentAsString());

        JsonNode zonas = cuerpo.get("zonas");
        assertEquals(ZONAS_SEMBRADAS, zonas.size(), "the response must carry the seeded zones");
        Map<String, JsonNode> zonaPorId = new HashMap<>();
        zonas.forEach(nodo -> zonaPorId.put(nodo.get("id").asText(), nodo));

        JsonNode suba = zonaPorId.get("Suba");
        assertNotNull(suba, "the Suba zone must be present");
        assertEquals("Suba", suba.get("nombre").asText(), "the Suba zone must be named Suba");
        assertEquals(4.73d, suba.get("ubicacion").get("lat").asDouble(), DELTA,
                "the Suba zone lat must match the seed");
        assertEquals(-74.08d, suba.get("ubicacion").get("lng").asDouble(), DELTA,
                "the Suba zone lng must match the seed");

        JsonNode centros = cuerpo.get("centros");
        assertEquals(CENTROS_SEMBRADOS, centros.size(), "the response must carry the 3 seeded centers");
        Map<String, JsonNode> centroPorNombre = new HashMap<>();
        centros.forEach(nodo -> centroPorNombre.put(nodo.get("nombre").asText(), nodo));

        // Names and coordinates are reused literally from the front fixtures.
        assertCentro(centroPorNombre, "Acopio Suba Norte", 4.742d, -74.09d);
        assertCentro(centroPorNombre, "Acopio La Gaitana", 4.72d, -74.05d);
        assertCentro(centroPorNombre, "Acopio Tibabuyes", 4.73d, -74.1d);

        // Every center's zonaId resolves to a zone the same response publishes.
        centroPorNombre.values().forEach(centro -> assertNotNull(
                zonaPorId.get(centro.get("zonaId").asText()),
                "every center's zonaId must be one of the returned zones"));
    }

    // -----------------------------------------------------------------------
    // 401 without a token: the route is declared, not denied by default
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET /mapa without token: 401 NO_AUTENTICADO (not a silent default deny)")
    void t2_sinToken_devuelve401() throws Exception {
        mockMvc.perform(get("/api/v1/mapa"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("GET /mapa with an invalid token: 401")
    void t3_tokenInvalido_devuelve401() throws Exception {
        mockMvc.perform(get("/api/v1/mapa")
                        .header("Authorization", "Bearer token-invalido"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // Seeding is idempotent for zones too
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Re-running the seeder does not duplicate zones: the count stays at 6")
    void t4_elSeedDeZonasEsIdempotente() {
        assertEquals(ZONAS_SEMBRADAS, zonaJpaRepository.count(),
                "startup must seed exactly the zones of the catalog");

        assertDoesNotThrow(() -> dataSeeder.run(), "re-running the seeder must not fail");
        assertEquals(ZONAS_SEMBRADAS, zonaJpaRepository.count(),
                "the second seeder run must insert 0 zones");

        assertDoesNotThrow(() -> dataSeeder.run(), "a third seeder run must not fail");
        assertEquals(ZONAS_SEMBRADAS, zonaJpaRepository.count(),
                "the third seeder run must still insert 0 zones");
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
