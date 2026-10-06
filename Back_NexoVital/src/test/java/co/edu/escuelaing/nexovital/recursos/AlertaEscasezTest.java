package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasezActiva;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.ConsultarAlertasEscasezUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pruebas de la alerta de escasez (EP-03.F1.US5) y de su consulta por el
 * donante (EP-03.F3.US4).
 *
 * <p>La alerta NO se guarda: existe mientras un recurso esté por debajo de lo
 * que su centro declaró necesitar, y se calcula del inventario en cada lectura.
 * Escenarios cubiertos:
 * <ul>
 *   <li><b>US5</b> — un recurso en 5 de 8 muestra la alerta con 3 faltantes.</li>
 *   <li>Una donación parcial reduce el faltante; la que completa la necesidad
 *       hace desaparecer la alerta, sin endpoint ni acción de administrador.</li>
 *   <li>Un recurso cubierto o sin requerimiento no genera alerta.</li>
 *   <li>Un retiro rechazado (409) no crea ninguna alerta.</li>
 *   <li><b>US4</b> — con 2 centros con alertas activas, el mapa publica cada
 *       centro con el recurso y la cantidad que le falta.</li>
 *   <li>El centro publica todas sus alertas con la peor primero.</li>
 * </ul>
 *
 * <p>Patrón de la casa: perfil {@code test} (H2 + seed) y login real para el
 * token. Cada test crea sus PROPIOS items (id aleatorio, prefijo) y los borra
 * al final: la H2 es compartida y otros tests leen cantidades exactas del
 * inventario sembrado.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class AlertaEscasezTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String ADMIN = "admin@nexovital.co";
    private static final String ADMIN_PASSWORD = "admin123";

    /** Prefix of the items created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba US5-ESC ";

    @Autowired
    private ConsultarAlertasEscasezUseCase consultarAlertasEscasezUseCase;

    @Autowired
    private RegistrarDonacionUseCase registrarDonacionUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    private UUID centroId;
    private UUID otroCentroId;

    @BeforeEach
    void resolverCentrosDePrueba() {
        centroId = centroIdPorNombre("Acopio Suba Norte");
        otroCentroId = centroIdPorNombre("Acopio La Gaitana");
    }

    @AfterEach
    void limpiarDatosDePrueba() {
        List<ItemInventarioJpaEntity> itemsABorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(itemsABorrar);
    }

    // -----------------------------------------------------------------------
    // EP-03.F1.US5 — the alert is the missing quantity
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("US5: un recurso en 5 de 8 genera la alerta con 3 faltantes")
    void recursoPorDebajoDelMaximoGeneraAlerta() {
        UUID itemId = sembrarItem(centroId, 5, 8);

        AlertaEscasezActiva alerta = alertaDe(itemId);

        assertNotNull(alerta, "un recurso por debajo de su máximo tiene alerta activa");
        assertEquals(centroId, alerta.centroAcopioId());
        assertEquals(8, alerta.requerido());
        assertEquals(5, alerta.disponible());
        assertEquals(3, alerta.faltante(), "faltante = requerido - disponible = 8 - 5");
    }

    @Test
    @DisplayName("Una donación parcial reduce el faltante de la alerta")
    void donacionParcialReduceElFaltante() {
        UUID itemId = sembrarItem(centroId, 5, 8);

        registrarDonacionUseCase.donar(centroId, itemId, 2);

        AlertaEscasezActiva alerta = alertaDe(itemId);
        assertNotNull(alerta, "todavía falta una unidad: la alerta sigue activa");
        assertEquals(7, alerta.disponible());
        assertEquals(1, alerta.faltante());
    }

    @Test
    @DisplayName("US5: la alerta desaparece cuando una donación completa la necesidad")
    void donacionQueCompletaLaNecesidadApagaLaAlerta() {
        UUID itemId = sembrarItem(centroId, 5, 8);

        registrarDonacionUseCase.donar(centroId, itemId, 3);

        assertNull(alertaDe(itemId), "con 8 de 8 ya no falta nada: no hay alerta");
    }

    @Test
    @DisplayName("Un recurso cubierto o sin requerimiento no genera alerta")
    void recursoCubiertoOSinRequerimientoNoGeneraAlerta() {
        UUID cubierto = sembrarItem(centroId, 8, 8);
        UUID sobrado = sembrarItem(centroId, 12, 8);
        UUID sinRequerimiento = sembrarItem(centroId, 0, 0);

        assertNull(alertaDe(cubierto));
        assertNull(alertaDe(sobrado));
        assertNull(alertaDe(sinRequerimiento));
    }

    @Test
    @DisplayName("Un retiro rechazado por stock insuficiente no crea ninguna alerta")
    void retiroRechazadoNoCreaAlerta() throws Exception {
        UUID itemId = sembrarItem(centroId, 5, 5);
        String token = tokenDe(ADMIN, ADMIN_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 8))))
                .andExpect(status().isConflict());

        assertEquals(5, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible(),
                "un rechazo no mueve el stock");
        assertNull(alertaDe(itemId), "el recurso sigue cubierto (5 de 5): un retiro rechazado no crea alerta");
    }

    // -----------------------------------------------------------------------
    // EP-03.F3.US4 — the donor sees each center with what it is missing
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("US4: con 2 centros con alertas, el mapa publica cada centro con el recurso y el faltante")
    void mapaPublicaLasAlertasDeCadaCentro() throws Exception {
        UUID itemUno = sembrarItem(centroId, 5, 8);
        UUID itemDos = sembrarItem(otroCentroId, 10, 30);

        JsonNode mapa = mapaComo(CIUDADANO, CIUDADANO_PASSWORD);

        JsonNode alertaUno = alertaEnMapa(mapa, centroId, itemUno);
        assertNotNull(alertaUno, "el primer centro publica la alerta de su recurso");
        assertEquals(PREFIJO_PRUEBA + itemUno, alertaUno.get("nombre").asText());
        assertEquals(8, alertaUno.get("requerido").asInt());
        assertEquals(5, alertaUno.get("disponible").asInt());
        assertEquals(3, alertaUno.get("faltante").asInt());

        JsonNode alertaDos = alertaEnMapa(mapa, otroCentroId, itemDos);
        assertNotNull(alertaDos, "el segundo centro publica la alerta de su recurso");
        assertEquals(20, alertaDos.get("faltante").asInt());
    }

    @Test
    @DisplayName("El centro publica todas sus alertas con la peor primero, y la peor es la del marcador")
    void centroPublicaSusAlertasOrdenadasPorFaltante() throws Exception {
        sembrarItem(centroId, 5, 8);
        // Larger than any seeded gap, so it is deterministically the worst.
        UUID peor = sembrarItem(centroId, 0, 5000);

        JsonNode centro = centroPorId(mapaComo(CIUDADANO, CIUDADANO_PASSWORD), centroId);
        assertNotNull(centro);
        JsonNode alertas = centro.get("alertas");

        assertTrue(alertas.size() >= 2, "el centro publica cada recurso que le falta");
        assertEquals(alertas.size(), centro.get("alertasActivas").asInt(),
                "alertasActivas cuenta las alertas publicadas");
        assertEquals(peor.toString(), alertas.get(0).get("itemId").asText(), "la peor alerta va primero");
        assertEquals(peor.toString(), centro.get("alerta").get("itemId").asText(),
                "la alerta del marcador es la peor");
        for (int i = 1; i < alertas.size(); i++) {
            assertTrue(alertas.get(i - 1).get("faltante").asInt() >= alertas.get(i).get("faltante").asInt(),
                    "las alertas van de mayor a menor faltante");
        }
    }

    @Test
    @DisplayName("La alerta sale del mapa cuando la donación completa la necesidad")
    void alertaSaleDelMapaAlCompletarLaNecesidad() throws Exception {
        UUID itemId = sembrarItem(centroId, 5, 8);
        assertNotNull(alertaEnMapa(mapaComo(CIUDADANO, CIUDADANO_PASSWORD), centroId, itemId));

        registrarDonacionUseCase.donar(centroId, itemId, 3);

        assertNull(alertaEnMapa(mapaComo(CIUDADANO, CIUDADANO_PASSWORD), centroId, itemId),
                "con la necesidad cubierta el centro deja de publicar la alerta");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Seeds an isolated item of this test in the given center. */
    private UUID sembrarItem(UUID centro, int disponible, int requerido) {
        UUID itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId,
                centro,
                PREFIJO_PRUEBA + itemId,
                disponible,
                requerido,
                null,
                null));
        return itemId;
    }

    /** Active alert of the item through the public port, or {@code null}. */
    private AlertaEscasezActiva alertaDe(UUID itemId) {
        return consultarAlertasEscasezUseCase.listarActivas().stream()
                .filter(alerta -> alerta.itemId().equals(itemId))
                .findFirst()
                .orElse(null);
    }

    /** Reads {@code GET /api/v1/mapa} with a real token. */
    private JsonNode mapaComo(String email, String password) throws Exception {
        MvcResult respuesta = mockMvc.perform(get("/api/v1/mapa")
                        .header("Authorization", "Bearer " + tokenDe(email, password)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(respuesta.getResponse().getContentAsString());
    }

    /** Alert of the item inside the center's {@code alertas}, or {@code null}. */
    private JsonNode alertaEnMapa(JsonNode mapa, UUID centroIdBuscado, UUID itemId) {
        JsonNode centro = centroPorId(mapa, centroIdBuscado);
        assertNotNull(centro, "el centro sembrado debe estar en el mapa");
        for (JsonNode alerta : centro.get("alertas")) {
            if (itemId.toString().equals(alerta.get("itemId").asText())) {
                return alerta;
            }
        }
        return null;
    }

    /** Finds the center with the given id inside the map payload, or {@code null}. */
    private JsonNode centroPorId(JsonNode cuerpo, UUID centroIdBuscado) {
        for (JsonNode centro : cuerpo.get("centros")) {
            if (centroIdBuscado.toString().equals(centro.get("id").asText())) {
                return centro;
            }
        }
        return null;
    }

    /** Id of a seeded center, resolved through the public use case of usuarios. */
    private UUID centroIdPorNombre(String nombre) {
        return listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals(nombre))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("seeded center not found: " + nombre));
    }

    /** Logs in with real credentials and returns the issued token. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
