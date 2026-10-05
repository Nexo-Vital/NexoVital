package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.domain.model.Semaforo;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarSemaforoCentrosUseCase;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-level cases of {@code GET /api/v1/centros-acopio/{id}/inventario}: la
 * ruta que fija el contrato OpenAPI (EP-03.F1), protegida por la cadena de
 * seguridad, devolviendo el inventario sembrado con el semáforo de cada item.
 *
 * <p>Sigue el patrón de la casa: login real para el token, perfil {@code test}
 * (H2 + seed) y reloj controlado. El semáforo de centro se verifica contra el
 * caso de uso, que no tiene endpoint propio en esta rebanada.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class InventarioHttpTest extends LoginTestBase {

    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** Items seeded for Acopio Suba Norte in {@code DataSeeder}. */
    private static final int ITEMS_SUBA_NORTE = 4;

    /** Prefix of the centers created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba INV ";

    @Autowired
    private ConsultarSemaforoCentrosUseCase consultarSemaforoCentrosUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private OrganizacionJpaRepository organizacionJpaRepository;

    /** Removes the centers this class created; the H2 test DB is shared by the context. */
    @AfterEach
    void limpiarCentrosDePrueba() {
        List<OrganizacionJpaEntity> aBorrar = organizacionJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        organizacionJpaRepository.deleteAll(aBorrar);
    }

    // -----------------------------------------------------------------------
    // 200 with a real token: the seeded inventory with the per-item semaphore
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET inventario with token: 200, the seeded items and their traffic light")
    void t1_conToken_devuelveElInventarioConSemaforo() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        UUID subaNorte = centroIdPorNombre("Acopio Suba Norte");

        MvcResult resultado = mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", subaNorte)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode items = objectMapper.readTree(resultado.getResponse().getContentAsString());
        assertTrue(items.isArray(), "the contract fixes an array of InventarioItem");
        assertEquals(ITEMS_SUBA_NORTE, items.size(), "Suba Norte has 4 seeded items");

        Map<String, JsonNode> porNombre = new HashMap<>();
        items.forEach(nodo -> porNombre.put(nodo.get("nombre").asText(), nodo));

        // Quantities are literal from the front fixtures; the level comes from
        // the domain rule (35/70/100).
        assertItem(porNombre, "Agua potable", 12, 60, "ROJO");
        assertItem(porNombre, "Kits de higiene", 18, 40, "AMARILLO");
        assertItem(porNombre, "Medicamentos básicos", 32, 35, "VERDE");
        assertItem(porNombre, "Cobijas", 44, 50, "VERDE");

        JsonNode agua = porNombre.get("Agua potable");
        assertDoesNotThrow(() -> UUID.fromString(agua.get("id").asText()),
                "the item id must be a UUID");
        assertEquals(subaNorte.toString(), agua.get("centroAcopioId").asText(),
                "each item must name the center it belongs to");
    }

    // -----------------------------------------------------------------------
    // 404 when the center does not exist
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET inventario of an unknown center: 404 CENTRO_ACOPIO_NO_ENCONTRADO")
    void t2_centroInexistente_devuelve404() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", UUID.randomUUID())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("CENTRO_ACOPIO_NO_ENCONTRADO"));
    }

    // -----------------------------------------------------------------------
    // 401 without a token: the route is declared, not denied by default
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET inventario without token: 401 NO_AUTENTICADO (not a silent default deny)")
    void t3_sinToken_devuelve401() throws Exception {
        mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", UUID.randomUUID()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // Center-level semaphore: the WORST item wins
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Center semaphore is the worst item: Suba Norte ROJO, La Gaitana AMARILLO, Tibabuyes VERDE")
    void t4_elSemaforoDelCentroEsElPeorItem() {
        Map<UUID, Semaforo> semaforos = consultarSemaforoCentrosUseCase.consultar();

        assertEquals(Semaforo.ROJO, semaforos.get(centroIdPorNombre("Acopio Suba Norte")),
                "Suba Norte is only as healthy as Agua potable (20%)");
        assertEquals(Semaforo.AMARILLO, semaforos.get(centroIdPorNombre("Acopio La Gaitana")),
                "La Gaitana is only as healthy as Alimentos (45%)");
        assertEquals(Semaforo.VERDE, semaforos.get(centroIdPorNombre("Acopio Tibabuyes")),
                "Tibabuyes has every item at or above 70%");
    }

    @Test
    @DisplayName("A center with no inventory is ABSENT from the semaphore map, never invented as VERDE")
    void t5_unCentroSinInventarioNoEstaEnElMapa() {
        UUID sinInventario = UUID.randomUUID();
        organizacionJpaRepository.save(new OrganizacionJpaEntity(
                sinInventario,
                PREFIJO_PRUEBA + sinInventario,
                TipoOrganizacion.CENTRO_ACOPIO,
                "Suba",
                4.6d,
                -74.1d));

        Map<UUID, Semaforo> semaforos = consultarSemaforoCentrosUseCase.consultar();

        assertFalse(semaforos.containsKey(sinInventario),
                "a center without inventory must be absent, not defaulted to VERDE");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Id of a seeded center, resolved through the public use case of usuarios. */
    private UUID centroIdPorNombre(String nombre) {
        return listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals(nombre))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("seeded center not found: " + nombre));
    }

    private static void assertItem(Map<String, JsonNode> porNombre,
                                   String nombre,
                                   int disponible,
                                   int requerido,
                                   String semaforo) {
        JsonNode item = porNombre.get(nombre);
        assertNotNull(item, "the seeded item must be present: " + nombre);
        assertEquals(disponible, item.get("disponible").asInt(), "disponible de " + nombre);
        assertEquals(requerido, item.get("requerido").asInt(), "requerido de " + nombre);
        assertEquals(semaforo, item.get("semaforo").asText(), "semáforo de " + nombre);
    }

    /** Logs in with real credentials and returns the issued token. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
