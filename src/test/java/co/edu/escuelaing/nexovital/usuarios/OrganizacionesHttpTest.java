package co.edu.escuelaing.nexovital.usuarios;

import co.edu.escuelaing.nexovital.infrastructure.config.DataSeeder;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaEntity;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaRepository;
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

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-level cases of {@code GET /api/v1/organizaciones}: the route declared in
 * the contract, protected by the security chain, returning the seeded centers.
 *
 * <p>Follows the house pattern: real login for the token, {@code test} profile
 * (H2 + seeding), and the controlled clock.
 *
 * <p>Also covers {@code POST /api/v1/organizaciones} (registrar una
 * organización, EP-01.F2.US1): 201 with a real platform-admin token, the
 * optional {@code zonaId}, the duplicate rejection and the mandatory-field
 * envelope. The emission case lives in {@code OrganizacionEmisionTest}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class OrganizacionesHttpTest extends LoginTestBase {

    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** Platform administrator (DataSeeder): the only role allowed to register. */
    private static final String ADMIN_PLATAFORMA = "admin@nexovital.co";
    private static final String ADMIN_PLATAFORMA_PASSWORD = "admin123";

    /** Catalog seeded in {@link DataSeeder}: the 3 Bogotá centers of the front. */
    private static final int ORGANIZACIONES_SEMBRADAS = 3;

    /**
     * Prefix of every name created through the POST in this test class. The H2
     * test database is shared by the context, so the created rows are deleted
     * afterwards; otherwise the seed count assertions (t1/t6) would break.
     */
    private static final String PREFIJO_PRUEBA = "Prueba OR-8 ";

    private static final double DELTA = 0.0000001d;

    @Autowired
    private DataSeeder dataSeeder;

    @Autowired
    private OrganizacionJpaRepository organizacionJpaRepository;

    /** Removes the organizations this class created through the POST. */
    @AfterEach
    void limpiarOrganizacionesDePrueba() {
        List<OrganizacionJpaEntity> aBorrar = organizacionJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        organizacionJpaRepository.deleteAll(aBorrar);
    }

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
    // POST /organizaciones — registrar una organización (EP-01.F2.US1)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST /organizaciones con ADMIN_PLATAFORMA: 201 con id UUID, nombre, tipo, ubicacion y zonaId")
    void t7_conAdminPlataformaRegistraLaOrganizacion() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();

        MvcResult resultado = mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(nombre, "CENTRO_AYUDA", 4.6d, -74.1d, "Suba")))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode organizacion = objectMapper.readTree(resultado.getResponse().getContentAsString());
        assertDoesNotThrow(() -> UUID.fromString(organizacion.get("id").asText()),
                "el id debe ser un UUID válido");
        assertEquals(nombre, organizacion.get("nombre").asText());
        assertEquals("CENTRO_AYUDA", organizacion.get("tipo").asText());
        assertEquals("Suba", organizacion.get("zonaId").asText());
        assertEquals(4.6d, organizacion.get("ubicacion").get("lat").asDouble(), DELTA);
        assertEquals(-74.1d, organizacion.get("ubicacion").get("lng").asDouble(), DELTA);
    }

    @Test
    @DisplayName("POST /organizaciones sin zonaId: 201 y la respuesta trae zonaId nulo (el contrato no lo exige)")
    void t8_sinZonaIdSeAceptaConZonaIdNulo() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();

        // Se omite zonaId por completo en el cuerpo.
        String cuerpoSinZona = objectMapper.writeValueAsString(Map.of(
                "nombre", nombre,
                "tipo", "CENTRO_ACOPIO",
                "ubicacion", Map.of("lat", 4.6d, "lng", -74.1d)));

        MvcResult resultado = mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSinZona))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode organizacion = objectMapper.readTree(resultado.getResponse().getContentAsString());
        assertEquals(nombre, organizacion.get("nombre").asText());
        assertTrue(organizacion.get("zonaId").isNull(),
                "la respuesta debe traer zonaId nulo cuando no se envió");
    }

    @Test
    @DisplayName("POST /organizaciones con un nombre ya usado: 400 ORGANIZACION_DUPLICADA")
    void t9_nombreDuplicadoDevuelve400() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();
        String cuerpo = cuerpo(nombre, "CENTRO_ACOPIO", 4.6d, -74.1d, "Suba");

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("ORGANIZACION_DUPLICADA"));
    }

    @Test
    @DisplayName("POST /organizaciones sin nombre: 400 DATOS_INVALIDOS con el campo nombrado (AC3)")
    void t10_sinNombreDevuelve400NombrandoElCampo() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String cuerpoSinNombre = objectMapper.writeValueAsString(Map.of(
                "tipo", "CENTRO_ACOPIO",
                "ubicacion", Map.of("lat", 4.6d, "lng", -74.1d)));

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSinNombre))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"))
                .andExpect(jsonPath("$.mensaje").value("El nombre es obligatorio."));
    }

    @Test
    @DisplayName("POST /organizaciones sin tipo: 400 DATOS_INVALIDOS con el campo nombrado (AC3)")
    void t11_sinTipoDevuelve400NombrandoElCampo() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String cuerpoSinTipo = objectMapper.writeValueAsString(Map.of(
                "nombre", PREFIJO_PRUEBA + UUID.randomUUID(),
                "ubicacion", Map.of("lat", 4.6d, "lng", -74.1d)));

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSinTipo))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"))
                .andExpect(jsonPath("$.mensaje").value("El tipo de organización es obligatorio."));
    }

    @Test
    @DisplayName("POST /organizaciones sin ubicacion: 400 DATOS_INVALIDOS con el campo nombrado (AC3)")
    void t12_sinUbicacionDevuelve400NombrandoElCampo() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String cuerpoSinUbicacion = objectMapper.writeValueAsString(Map.of(
                "nombre", PREFIJO_PRUEBA + UUID.randomUUID(),
                "tipo", "CENTRO_ACOPIO"));

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoSinUbicacion))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"))
                .andExpect(jsonPath("$.mensaje").value("La ubicación es obligatoria."));
    }

    @Test
    @DisplayName("POST /organizaciones sin token: 401 NO_AUTENTICADO")
    void t13_sinTokenDevuelve401() throws Exception {
        mockMvc.perform(post("/api/v1/organizaciones")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(PREFIJO_PRUEBA + UUID.randomUUID(), "CENTRO_ACOPIO", 4.6d, -74.1d, "Suba")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("POST /organizaciones con un rol autenticado pero no autorizado: 403 ACCESO_DENEGADO")
    void t14_rolNoAutorizadoDevuelve403() throws Exception {
        // Rangel is ADMIN_CENTRO_AYUDA: authenticated, but not the platform admin.
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo(PREFIJO_PRUEBA + UUID.randomUUID(), "CENTRO_ACOPIO", 4.6d, -74.1d, "Suba")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Serializes a full request body, with zonaId. */
    private String cuerpo(String nombre, String tipo, double lat, double lng, String zonaId) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "nombre", nombre,
                "tipo", tipo,
                "ubicacion", Map.of("lat", lat, "lng", lng),
                "zonaId", zonaId));
    }

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
