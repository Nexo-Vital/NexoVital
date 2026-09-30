package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.application.usecase.InventarioPushListener;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;
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
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Casos HTTP de {@code POST /api/v1/centros-acopio/{id}/inventario/despacho}: el
 * despacho atómico (C1) protegido por la cadena de seguridad, con 200 en cada
 * descuento válido y 409 cuando el stock no alcanza.
 *
 * <p>Sigue el patrón de la casa: login real para el token, perfil {@code test}
 * (H2 + seed) y reloj controlado. Cada test crea su PROPIO item de inventario
 * (id aleatorio, nombre con prefijo) y lo borra al final: así no altera el
 * inventario sembrado que otros tests leen por cantidad exacta.
 *
 * <p>Se inyecta el doble del {@code PushPort} ({@link PushPortDePrueba},
 * {@code @Primary}) para asertar el destino y el payload del push post-commit
 * sin depender del broker: el contrato declara {@code /topic/suministros} para
 * la operación.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class DespachoHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    /** Prefix of the items created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba DESP ";

    private static final int DISPONIBLE_INICIAL = 3;
    private static final int REQUERIDO = 1;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private UUID centroId;
    private UUID itemId;

    /** Centro sembrado + item de prueba aislado con stock 3, para no tocar el seed. */
    @BeforeEach
    void sembrarItemDePrueba() {
        pushPortDePrueba.limpiar();
        centroId = centroIdPorNombre("Acopio Suba Norte");
        itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId,
                centroId,
                PREFIJO_PRUEBA + itemId,
                DISPONIBLE_INICIAL,
                REQUERIDO,
                null,
                null));
    }

    /** Removes this class' items and the captured pushes. */
    @AfterEach
    void limpiarItemsDePrueba() {
        List<ItemInventarioJpaEntity> aBorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(aBorrar);
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // The AC + C1 over HTTP: three dispatches exhaust stock 3, the fourth is 409
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("C1 HTTP: 3 despachos de 1 sobre stock 3 dan 200; el cuarto da 409 STOCK_INSUFICIENTE")
    void invarianteC1_Stock3_TresDespachos200YElCuarto409() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        for (int i = 0; i < DISPONIBLE_INICIAL; i++) {
            mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "itemId", itemId.toString(),
                                    "cantidad", 1))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(itemId.toString()))
                    .andExpect(jsonPath("$.disponible").value(DISPONIBLE_INICIAL - i - 1))
                    .andExpect(jsonPath("$.semaforo").isNotEmpty());
        }

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 1))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("STOCK_INSUFICIENTE"));

        // La base es la fuente de verdad y el stock nunca quedó negativo.
        assertEquals(0, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible(),
                "tras 3 despachos el stock queda agotado, nunca negativo");

        // La lectura pública ve el stock nuevo (read-after-write) y su semáforo.
        MvcResult inventario = mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", centroId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode itemLeido = buscarItem(objectMapper.readTree(inventario.getResponse().getContentAsString()));
        assertNotNull(itemLeido, "el item despachado debe aparecer en la lectura de inventario");
        assertEquals(0, itemLeido.get("disponible").asInt(), "la lectura debe reflejar el descuento");
        assertEquals("ROJO", itemLeido.get("semaforo").asText(), "stock 0 con requerido 1 es ROJO");
    }

    // -----------------------------------------------------------------------
    // The contract publishes the updated traffic light post-commit
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("El despacho publica el ItemInventarioDto actualizado en /topic/suministros (post-commit)")
    void publicaElSemaforoEnElTopicoDeSuministros() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 1))))
                .andExpect(status().isOk());

        PublicacionCapturada publicacion =
                pushPortDePrueba.ultimaHacia(InventarioPushListener.DESTINO_SUMINISTROS);
        assertNotNull(publicacion,
                "un despacho debe publicar en " + InventarioPushListener.DESTINO_SUMINISTROS);
        assertInstanceOf(ItemInventarioDto.class, publicacion.payload(),
                "el payload es el ItemInventarioDto ya proyectado por el módulo");
        assertEquals(DISPONIBLE_INICIAL - 1, ((ItemInventarioDto) publicacion.payload()).disponible(),
                "el push lleva el stock ya descontado, no un cálculo en Java");
    }

    // -----------------------------------------------------------------------
    // 404 for an unknown item; 401 without a token; 400 for an invalid quantity
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST despacho a un item inexistente: 404 ITEM_INVENTARIO_NO_ENCONTRADO")
    void itemInexistenteDevuelve404() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", UUID.randomUUID().toString(),
                                "cantidad", 1))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("ITEM_INVENTARIO_NO_ENCONTRADO"));
    }

    @Test
    @DisplayName("POST despacho sin token: 401 NO_AUTENTICADO (not a silent 403)")
    void sinTokenDevuelve401() throws Exception {
        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 1))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    @DisplayName("POST despacho con cantidad 0 o nula: 400 DATOS_INVALIDOS")
    void cantidadInvalidaDevuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 0))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":\"" + itemId + "\",\"cantidad\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Finds this test's item inside the inventory array, or {@code null}. */
    private JsonNode buscarItem(JsonNode inventario) {
        for (JsonNode nodo : inventario) {
            if (itemId.toString().equals(nodo.get("id").asText())) {
                return nodo;
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
