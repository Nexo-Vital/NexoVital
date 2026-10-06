package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.application.usecase.AlertaEscasezPushListener;
import co.edu.escuelaing.nexovital.recursos.domain.exception.StockInsuficienteException;
import co.edu.escuelaing.nexovital.recursos.domain.model.AlertaEscasez;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.DespacharStockUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.AlertaEscasezRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.AlertaEscasezJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.AlertaEscasezJpaRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pruebas de la alerta de escasez (EP-03.F1.US5, Azure 225).
 *
 * <p>Cubre, escenario por escenario, lo que la historia exige:
 * <ul>
 *   <li><b>FA-6</b> — un despacho RECHAZADO tiene que dejar la alerta en la
 *       base: el rechazo revierte su transacción y la alerta se persiste en
 *       otra. Sin esta prueba el bug más probable de la historia queda sin
 *       cubrir.</li>
 *   <li><b>AC</b> — 5 disponibles, se solicitan 8 → 409 y alerta activa que
 *       nombra el recurso con faltante 3.</li>
 *   <li><b>FA-3</b> — la donación que cubre la demanda vuelve inactiva la
 *       alerta, sin endpoint ni acción de admin.</li>
 *   <li><b>FA-4</b> — varias solicitudes sobre el mismo item: gana la mayor y
 *       una menor no baja la alerta ya levantada.</li>
 *   <li><b>FA-5</b> — el mapa del centro publica la peor alerta activa.</li>
 * </ul>
 *
 * <p>Patrón de la casa: perfil {@code test} (H2 + seed), login real para el
 * token, reloj controlado y doble del {@code PushPort}. Cada test crea su PROPIO
 * item (id aleatorio, prefijo) y limpia sus items y alertas al final: la H2 es
 * compartida y otros tests leen cantidades exactas del inventario sembrado.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class AlertaEscasezTest extends LoginTestBase {

    private static final String ADMIN = "admin@nexovital.co";
    private static final String ADMIN_PASSWORD = "admin123";

    /** Prefix of the items created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba US5-ESC ";

    private static final int REQUERIDO = 100;

    @Autowired
    private DespacharStockUseCase despacharStockUseCase;

    @Autowired
    private RegistrarDonacionUseCase registrarDonacionUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private AlertaEscasezRepository alertaEscasezRepository;

    @Autowired
    private AlertaEscasezJpaRepository alertaEscasezJpaRepository;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private UUID centroId;

    @BeforeEach
    void resolverCentroDePrueba() {
        centroId = centroIdPorNombre("Acopio Suba Norte");
    }

    @AfterEach
    void limpiarDatosDePrueba() {
        List<ItemInventarioJpaEntity> itemsABorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(itemsABorrar);

        List<AlertaEscasezJpaEntity> alertasABorrar = alertaEscasezJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        alertaEscasezJpaRepository.deleteAll(alertasABorrar);
    }

    // -----------------------------------------------------------------------
    // FA-6 — the alert survives the rollback of the rejected dispatch
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FA-6: un despacho rechazado (409) deja la alerta PERSISTIDA en la base, pese al rollback")
    void fa6_elRechazoDejaLaAlertaEnLaBase() throws Exception {
        UUID itemId = sembrarItem(5);
        String token = tokenDe(ADMIN, ADMIN_PASSWORD);

        mockMvc.perform(despachoHttp(itemId, 8, token))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("STOCK_INSUFICIENTE"));

        // El 409 revierte la transacción del despacho. Si la alerta se hubiera
        // guardado dentro de esa transacción, acá no habría nada.
        List<AlertaEscasezJpaEntity> alertas = alertasDe(itemId);
        assertEquals(1, alertas.size(),
                "el rechazo debe dejar EXACTAMENTE una alerta persistida, sobreviviendo al rollback");
        AlertaEscasezJpaEntity alerta = alertas.get(0);
        assertEquals(centroId, alerta.getCentroAcopioId(), "la alerta debe apuntar al centro que rechazó");
        assertEquals(8, alerta.getCantidadSolicitada(), "la alerta guarda la demanda solicitada, no el déficit");
        assertTrue(alerta.getNombre().startsWith(PREFIJO_PRUEBA), "la alerta debe nombrar el recurso");
    }

    // -----------------------------------------------------------------------
    // Realtime: creating/updating the alert publishes AFTER its commit
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("push: crear la alerta publica en /topic/alerts tras el commit de su transaccion REQUIRES_NEW")
    void crearLaAlertaPublicaEnElTopicoPostCommit() throws Exception {
        pushPortDePrueba.limpiar();
        UUID itemId = sembrarItem(5);
        String token = tokenDe(ADMIN, ADMIN_PASSWORD);

        mockMvc.perform(despachoHttp(itemId, 8, token))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("STOCK_INSUFICIENTE"));

        PublicacionCapturada publicacion =
                pushPortDePrueba.ultimaHacia(AlertaEscasezPushListener.DESTINO_ALERTAS);
        assertNotNull(publicacion,
                "crear la alerta debe publicar en " + AlertaEscasezPushListener.DESTINO_ALERTAS);
        assertInstanceOf(AlertaEscasezPushListener.AlertaEscasezPushPayload.class, publicacion.payload(),
                "el payload es la proyeccion de la alerta ya armada por el modulo");

        AlertaEscasezPushListener.AlertaEscasezPushPayload payload =
                (AlertaEscasezPushListener.AlertaEscasezPushPayload) publicacion.payload();
        assertEquals(centroId, payload.centroAcopioId(), "la alerta publicada apunta al centro que rechazo");
        assertEquals(itemId, payload.itemId(), "la alerta publicada nombra el recurso rechazado");
        assertTrue(payload.nombre().startsWith(PREFIJO_PRUEBA), "la alerta publicada lleva el nombre del recurso");
        assertEquals(8, payload.cantidadSolicitada(), "publica la demanda solicitada, no el deficit");
        assertEquals(5, payload.disponibleActual(), "publica el stock visto al rechazar");
        assertEquals(3, payload.faltante(), "el faltante publicado es la necesidad actual: 8 - 5 = 3");
    }

    @Test
    @DisplayName("push: un rechazo que NO cambia la alerta (demanda ya mayor) no vuelve a publicar")
    void elRechazoQueNoCambiaLaAlertaNoRepublica() throws Exception {
        pushPortDePrueba.limpiar();
        UUID itemId = sembrarItem(0);
        String token = tokenDe(ADMIN, ADMIN_PASSWORD);

        // First rejection creates the alert (demand 20) and publishes once.
        mockMvc.perform(despachoHttp(itemId, 20, token)).andExpect(status().isConflict());
        // Second rejection asks for LESS: FA-4 keeps the larger demand, no write.
        mockMvc.perform(despachoHttp(itemId, 5, token)).andExpect(status().isConflict());

        long emitidas = pushPortDePrueba.publicaciones().stream()
                .filter(publicacion -> AlertaEscasezPushListener.DESTINO_ALERTAS.equals(publicacion.destino()))
                .count();
        assertEquals(1, emitidas,
                "solo el rechazo que Persiste la alerta emite; el que no la cambia no republica");
    }

    // -----------------------------------------------------------------------
    // AC — 5 available, request 8: 409 + active alert naming the resource
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC: 5 disponibles, se solicitan 8 → 409 y alerta activa con faltante 3 nombrando el recurso")
    void ac_cincoDisponiblesSolicitaOchoDejaAlertaDeTres() throws Exception {
        UUID itemId = sembrarItem(5);
        String token = tokenDe(ADMIN, ADMIN_PASSWORD);

        mockMvc.perform(despachoHttp(itemId, 8, token))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("STOCK_INSUFICIENTE"));

        AlertaEscasez alerta = alertaDe(itemId);
        assertEquals(8, alerta.getCantidadSolicitada(), "la demanda viva es la solicitada: 8");
        assertTrue(alerta.estaActiva(5), "con 5 disponibles la alerta sigue activa");
        assertEquals(3, alerta.faltante(5), "el faltante mostrado es la necesidad actual: 8 - 5 = 3");
        assertTrue(alerta.getNombre().startsWith(PREFIJO_PRUEBA), "la alerta nombra el recurso");
    }

    // -----------------------------------------------------------------------
    // FA-3 — the alert clears itself when a donation covers the demand
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FA-3: la donación que sube el stock a lo solicitado vuelve inactiva la alerta, sin acción de admin")
    void fa3_laDonacionQueCubreLaDemandaDesactivaLaAlerta() throws Exception {
        UUID itemId = sembrarItem(5);
        assertThrows(StockInsuficienteException.class, () -> despacharStockUseCase.despachar(centroId, itemId, 8));

        AlertaEscasez alerta = alertaDe(itemId);
        assertTrue(alerta.estaActiva(5), "tras el rechazo la alerta está activa");

        registrarDonacionUseCase.donar(centroId, itemId, 3);

        int stockAhora = itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible();
        assertEquals(8, stockAhora, "la donación debe dejar el stock en lo solicitado");
        assertFalse(alerta.estaActiva(stockAhora),
                "con el stock cubriendo la demanda, la alerta deja de estar activa por sí sola");
        assertEquals(0, alerta.faltante(stockAhora), "ya no falta nada por cubrir");

        // El registro sigue existiendo con su fecha: es trazabilidad, no un flag.
        assertEquals(1, alertasDe(itemId).size(), "la alerta se conserva como registro histórico");
    }

    // -----------------------------------------------------------------------
    // FA-4 — several requests on the same item: the largest demand wins
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FA-4: rechazos de 8 y luego 20 dejan demanda 20; un rechazo posterior de 5 no la baja")
    void fa4_laMayorDemandaGanaYLaMenorNoLaBaja() {
        UUID itemId = sembrarItem(0);

        assertThrows(StockInsuficienteException.class, () -> despacharStockUseCase.despachar(centroId, itemId, 8));
        assertEquals(8, alertaDe(itemId).getCantidadSolicitada(), "el primer rechazo levanta la demanda en 8");

        assertThrows(StockInsuficienteException.class, () -> despacharStockUseCase.despachar(centroId, itemId, 20));
        assertEquals(20, alertaDe(itemId).getCantidadSolicitada(), "una demanda mayor sube la alerta a 20");

        assertThrows(StockInsuficienteException.class, () -> despacharStockUseCase.despachar(centroId, itemId, 5));
        assertEquals(20, alertaDe(itemId).getCantidadSolicitada(), "una demanda menor NO puede bajar la alerta");

        assertEquals(1, alertasDe(itemId).size(), "sigue habiendo una sola alerta viva por item");
    }

    // -----------------------------------------------------------------------
    // FA-5 — the map carries the worst active alert of the center
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("FA-5: GET /mapa publica en el centro la peor alerta activa (recurso y faltante) y cuántas hay")
    void fa5_elMapaMuestraLaPeorAlertaActivaDelCentro() throws Exception {
        UUID itemId = sembrarItem(5);
        assertThrows(StockInsuficienteException.class, () -> despacharStockUseCase.despachar(centroId, itemId, 8));

        String token = tokenDe(ADMIN, ADMIN_PASSWORD);
        MvcResult resultado = mockMvc.perform(get("/api/v1/mapa")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode centro = centroPorId(objectMapper.readTree(resultado.getResponse().getContentAsString()), centroId);
        assertNotNull(centro, "el centro sembrado debe aparecer en el mapa");
        assertTrue(centro.get("alertasActivas").asInt() >= 1,
                "el centro debe reportar al menos la alerta activa de este test");
        JsonNode alerta = centro.get("alerta");
        assertNotNull(alerta, "el centro con alerta activa debe publicar la peor alerta");
        assertEquals(itemId.toString(), alerta.get("itemId").asText(),
                "la alerta publicada corresponde al recurso rechazado");
        assertEquals(3, alerta.get("faltante").asInt(),
                "el mapa muestra el faltante actual: 8 - 5 = 3");
        assertEquals(8, alerta.get("cantidadSolicitada").asInt(),
                "el mapa publica la demanda solicitada");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Seeds an isolated item of this test with the given stock. */
    private UUID sembrarItem(int disponible) {
        UUID itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId,
                centroId,
                PREFIJO_PRUEBA + itemId,
                disponible,
                REQUERIDO,
                null,
                null));
        return itemId;
    }

    /** POST del despacho de {@code cantidad} unidades de este item. */
    private org.springframework.test.web.servlet.RequestBuilder despachoHttp(UUID itemId, int cantidad, String token)
            throws Exception {
        return post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "itemId", itemId.toString(),
                        "cantidad", cantidad)));
    }

    /** Persisted alert rows for the item, straight from the database. */
    private List<AlertaEscasezJpaEntity> alertasDe(UUID itemId) {
        return alertaEscasezJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getItemId().equals(itemId))
                .toList();
    }

    /** The live alert through the domain port (largest demand wins). */
    private AlertaEscasez alertaDe(UUID itemId) {
        return alertaEscasezRepository.buscarMayorDemanda(centroId, itemId)
                .orElseThrow(() -> new AssertionError("expected a persisted shortage alert for item " + itemId));
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
