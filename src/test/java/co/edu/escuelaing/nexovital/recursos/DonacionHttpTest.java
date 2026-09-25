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
 * Casos HTTP de {@code POST /api/v1/centros-acopio/{id}/inventario/donacion}:
 * el crédito inmediato de una donación, protegido por la cadena de seguridad, y
 * la publicación post-commit en {@code /topic/suministros}.
 *
 * <p>Sigue el patrón de la casa: login real para el token, perfil {@code test}
 * (H2 + seed) y reloj controlado. Cada test crea su PROPIO item de inventario
 * (id aleatorio, nombre con prefijo) y lo borra al final: así no altera el
 * inventario sembrado que otros tests leen por cantidad exacta.
 *
 * <p>Se inyecta el doble del {@code PushPort} ({@link PushPortDePrueba},
 * {@code @Primary}) para asertar destino y payload sin depender del broker: es el
 * mismo enfoque de {@code OrganizacionEmisionTest}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class DonacionHttpTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";
    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";

    /** Prefix of the items created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba DON ";

    private static final int DISPONIBLE_INICIAL = 20;
    private static final int REQUERIDO = 100;
    private static final int CANTIDAD = 30;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private UUID centroId;
    private UUID itemId;

    /** Centro sembrado + item de prueba aislado, para no tocar el seed. */
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
                "unidades",
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
    // 200 with a real token: the donation credits and is published post-commit
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST donación con token: 200, acredita el stock, lo persiste y publica en /topic/suministros")
    void t1_creditaPersisteYPublica() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", CANTIDAD))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(itemId.toString()))
                .andExpect(jsonPath("$.disponible").value(DISPONIBLE_INICIAL + CANTIDAD))
                .andExpect(jsonPath("$.semaforo").value("AMARILLO"));

        // La base es la fuente de verdad: el crédito quedó persistido.
        assertEquals(DISPONIBLE_INICIAL + CANTIDAD,
                itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible(),
                "el crédito debe quedar persistido de forma atómica");

        // La lectura pública ve el stock nuevo (read-after-write).
        MvcResult inventario = mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", centroId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode itemLeido = buscarItem(objectMapper.readTree(inventario.getResponse().getContentAsString()));
        assertNotNull(itemLeido, "el item donado debe aparecer en la lectura de inventario");
        assertEquals(DISPONIBLE_INICIAL + CANTIDAD, itemLeido.get("disponible").asInt(),
                "la lectura debe reflejar el crédito");

        // El push se emite DESPUÉS del commit, con el DTO público (semaforo incluido).
        PublicacionCapturada publicacion =
                pushPortDePrueba.ultimaHacia(InventarioPushListener.DESTINO_SUMINISTROS);
        assertNotNull(publicacion,
                "una donación debe publicar en " + InventarioPushListener.DESTINO_SUMINISTROS);
        assertInstanceOf(ItemInventarioDto.class, publicacion.payload(),
                "el payload es el ItemInventarioDto ya proyectado por el módulo");
        ItemInventarioDto itemPublicado = (ItemInventarioDto) publicacion.payload();
        assertEquals(itemId, itemPublicado.id());
        assertEquals(DISPONIBLE_INICIAL + CANTIDAD, itemPublicado.disponible());
    }

    // -----------------------------------------------------------------------
    // Any authenticated role may donate, not only the citizen
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST donación con un rol distinto (ADMIN_CENTRO_AYUDA): 200, sin restricción de rol")
    void t2_cualquierRolAutenticadoPuedeDonar() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 5))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disponible").value(DISPONIBLE_INICIAL + 5));
    }

    // -----------------------------------------------------------------------
    // 400 when the quantity is not a positive integer
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST donación con cantidad 0, negativa o nula: 400 DATOS_INVALIDOS")
    void t3_cantidadInvalidaDevuelve400() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", 0))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", -5))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"itemId\":\"" + itemId + "\",\"cantidad\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // 401 without a token: the route is declared, not denied by default
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST donación sin token: 401 NO_AUTENTICADO")
    void t4_sinTokenDevuelve401() throws Exception {
        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", CANTIDAD))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // 404 for an unknown center or an unknown item
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST donación a un centro inexistente: 404 CENTRO_ACOPIO_NO_ENCONTRADO")
    void t5_centroInexistenteDevuelve404() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", UUID.randomUUID())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", itemId.toString(),
                                "cantidad", CANTIDAD))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("CENTRO_ACOPIO_NO_ENCONTRADO"));
    }

    @Test
    @DisplayName("POST donación a un item inexistente: 404 ITEM_INVENTARIO_NO_ENCONTRADO")
    void t6_itemInexistenteDevuelve404() throws Exception {
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/donacion", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "itemId", UUID.randomUUID().toString(),
                                "cantidad", CANTIDAD))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("ITEM_INVENTARIO_NO_ENCONTRADO"));
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
