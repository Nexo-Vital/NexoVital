package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.application.usecase.InventarioPushListener;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.application.usecase.OrganizacionPushListener;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaEntity;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaRepository;
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

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Casos HTTP del centro PROPIO del administrador de centro de ayuda
 * ({@code /api/v1/centros-acopio/mio}): consultarlo, crearlo con sus insumos,
 * declarar un insumo nuevo y retirar unidades con el despacho que ya existe.
 *
 * <p>Sigue el patrón de la casa: login real para el token, perfil {@code test}
 * (H2 + seed) y reloj controlado. Cada test crea su PROPIO centro (nombre con
 * prefijo) y al final se borran ese centro y sus insumos: así el seed que otros
 * tests leen por cantidad exacta queda intacto y el administrador vuelve a
 * quedar sin centro.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class MiCentroHttpTest extends LoginTestBase {

    private static final String RANGEL = "rangel@nexovital.co";
    private static final String RANGEL_PASSWORD = "rangel123";
    private static final String CENTRO = "centro@nexovital.co";
    private static final String CENTRO_PASSWORD = "centro123";
    private static final String ACOPIO = "acopio@nexovital.co";
    private static final String ACOPIO_PASSWORD = "acopio123";
    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    /** Prefix of the centers created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba MIC ";

    private static final String RUTA = "/api/v1/centros-acopio/mio";

    @Autowired
    private OrganizacionJpaRepository organizacionJpaRepository;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    @BeforeEach
    void limpiarAntes() {
        borrarCentrosDePrueba();
        pushPortDePrueba.limpiar();
    }

    @AfterEach
    void limpiarDespues() {
        borrarCentrosDePrueba();
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // Consultar
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET mio sin centro creado: 404 CENTRO_NO_REGISTRADO")
    void sinCentroDevuelve404() throws Exception {
        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + tokenDe(RANGEL, RANGEL_PASSWORD)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("CENTRO_NO_REGISTRADO"));
    }

    @Test
    @DisplayName("La ruta es fail-closed: sin token 401 y un CIUDADANO 403")
    void rutaProtegida() throws Exception {
        mockMvc.perform(get(RUTA))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));

        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + tokenDe(CIUDADANO, CIUDADANO_PASSWORD)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));

        mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + tokenDe(CIUDADANO, CIUDADANO_PASSWORD))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoCentro(PREFIJO_PRUEBA + "ajeno")))
                .andExpect(status().isForbidden());
    }

    // -----------------------------------------------------------------------
    // Crear
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST mio: 201, crea el centro con sus insumos, queda ligado al administrador y se publica")
    void creaElCentroConSusInsumos() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();

        MvcResult resultado = mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoCentro(nombre)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.nombre").value(nombre))
                .andExpect(jsonPath("$.ubicacion.lat").value(4.75d))
                .andExpect(jsonPath("$.items.length()").value(2))
                .andReturn();

        JsonNode creado = objectMapper.readTree(resultado.getResponse().getContentAsString());
        UUID centroId = UUID.fromString(creado.get("id").asText());

        // Agua 20 de 50 = 40 % -> AMARILLO; Cobijas 0 de 30 -> ROJO.
        Map<String, String> semaforoPorNombre = new HashMap<>();
        creado.get("items").forEach(item ->
                semaforoPorNombre.put(item.get("nombre").asText(), item.get("semaforo").asText()));
        assertEquals("AMARILLO", semaforoPorNombre.get("Agua"));
        assertEquals("ROJO", semaforoPorNombre.get("Cobijas"));

        // The same administrator reads it back; another administrator does not.
        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(centroId.toString()))
                .andExpect(jsonPath("$.items.length()").value(2));
        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + tokenDe(CENTRO, CENTRO_PASSWORD)))
                .andExpect(status().isNotFound());

        // It is a regular center for everyone else: public inventory and map.
        mockMvc.perform(get("/api/v1/centros-acopio/{id}/inventario", centroId)
                        .header("Authorization", "Bearer " + tokenDe(CIUDADANO, CIUDADANO_PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        // Post-commit pushes: the center on the map channel, each item on supplies.
        Set<String> destinos = pushPortDePrueba.publicaciones().stream()
                .map(PushPortDePruebaConfig.PublicacionCapturada::destino)
                .collect(Collectors.toSet());
        assertTrue(destinos.contains(OrganizacionPushListener.DESTINO_MAPA),
                "the new center must be published on the map channel");
        long itemsPublicados = pushPortDePrueba.publicaciones().stream()
                .filter(publicacion -> InventarioPushListener.DESTINO_SUMINISTROS.equals(publicacion.destino()))
                .count();
        assertEquals(2, itemsPublicados, "each initial item must be published once");
    }

    @Test
    @DisplayName("POST mio dos veces: el segundo es 409 CENTRO_YA_REGISTRADO")
    void unSoloCentroPorAdministrador() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        crearCentro(token, PREFIJO_PRUEBA + UUID.randomUUID());

        mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoCentro(PREFIJO_PRUEBA + UUID.randomUUID())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("CENTRO_YA_REGISTRADO"));
    }

    @Test
    @DisplayName("POST mio con un nombre ya usado: 409 NOMBRE_CENTRO_DUPLICADO y no queda centro")
    void nombreDuplicado() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);

        mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoCentro("Acopio Suba Norte")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("NOMBRE_CENTRO_DUPLICADO"));

        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("POST mio sin insumos (items vacío o ausente): 201, centro con inventario vacío")
    void creaUnCentroSinInventario() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();
        Map<String, Object> ubicacion = Map.of("lat", 4.75d, "lng", -74.06d);
        pushPortDePrueba.limpiar();

        mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("nombre", nombre, "ubicacion", ubicacion))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.nombre").value(nombre))
                .andExpect(jsonPath("$.items.length()").value(0));

        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    @DisplayName("El administrador de acopio hace lo mismo: crea su centro vacío y le agrega insumos")
    void elAdministradorDeAcopioGestionaSuCentro() throws Exception {
        String token = tokenDe(ACOPIO, ACOPIO_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();
        Map<String, Object> ubicacion = Map.of("lat", 4.75d, "lng", -74.06d);

        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());

        mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("nombre", nombre, "ubicacion", ubicacion))))
                .andExpect(status().isCreated());

        mockMvc.perform(post(RUTA + "/inventario")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("nombre", "Kits de emergencia", "disponible", 50, "requerido", 50))))
                .andExpect(status().isCreated());
        mockMvc.perform(post(RUTA + "/inventario")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("nombre", "Medicamento", "disponible", 20, "requerido", 20))))
                .andExpect(status().isCreated());

        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));
    }

    @Test
    @DisplayName("POST mio con datos inválidos: 400 DATOS_INVALIDOS y la base queda intacta")
    void datosInvalidos() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();
        Map<String, Object> ubicacion = Map.of("lat", 4.75d, "lng", -74.06d);
        Map<String, Object> agua = Map.of("nombre", "Agua", "disponible", 20, "requerido", 50);

        // No location.
        postInvalido(token, Map.of("nombre", nombre, "items", List.of(agua)));
        // Blank name.
        postInvalido(token, Map.of("nombre", "  ", "ubicacion", ubicacion, "items", List.of(agua)));
        // Repeated item, ignoring case.
        postInvalido(token, Map.of("nombre", nombre, "ubicacion", ubicacion, "items", List.of(
                agua, Map.of("nombre", "AGUA", "disponible", 1, "requerido", 5))));
        // The maximum must be at least 1.
        postInvalido(token, Map.of("nombre", nombre, "ubicacion", ubicacion, "items", List.of(
                Map.of("nombre", "Agua", "disponible", 20, "requerido", 0))));
        // Negative stock.
        postInvalido(token, Map.of("nombre", nombre, "ubicacion", ubicacion, "items", List.of(
                Map.of("nombre", "Agua", "disponible", -1, "requerido", 5))));
        // Latitude out of range.
        postInvalido(token, Map.of("nombre", nombre, "ubicacion", Map.of("lat", 400d, "lng", -74.06d),
                "items", List.of(agua)));

        mockMvc.perform(get(RUTA).header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        assertTrue(organizacionJpaRepository.findAll().stream()
                        .noneMatch(centro -> centro.getNombre().startsWith(PREFIJO_PRUEBA)),
                "a rejected request must not leave a center behind");
    }

    // -----------------------------------------------------------------------
    // Agregar y retirar insumos
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST mio/inventario: 201 agrega el insumo; el mismo nombre otra vez es 409")
    void agregaUnInsumo() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        UUID centroId = crearCentro(token, PREFIJO_PRUEBA + UUID.randomUUID());
        pushPortDePrueba.limpiar();

        mockMvc.perform(post(RUTA + "/inventario")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("nombre", "Alimentos", "disponible", 5, "requerido", 100))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.centroAcopioId").value(centroId.toString()))
                .andExpect(jsonPath("$.nombre").value("Alimentos"))
                .andExpect(jsonPath("$.disponible").value(5))
                .andExpect(jsonPath("$.requerido").value(100))
                .andExpect(jsonPath("$.semaforo").value("ROJO"));

        assertEquals(1, pushPortDePrueba.publicaciones().stream()
                .filter(publicacion -> InventarioPushListener.DESTINO_SUMINISTROS.equals(publicacion.destino()))
                .count(), "the new item must be published once on the supplies channel");

        mockMvc.perform(post(RUTA + "/inventario")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("nombre", "ALIMENTOS", "disponible", 1, "requerido", 10))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("ITEM_INVENTARIO_DUPLICADO"));

        assertEquals(3, itemInventarioJpaRepository.findByCentroAcopioIdOrderByNombreAsc(centroId).size());
    }

    @Test
    @DisplayName("POST mio/inventario sin centro: 404 CENTRO_NO_REGISTRADO")
    void agregarSinCentro() throws Exception {
        mockMvc.perform(post(RUTA + "/inventario")
                        .header("Authorization", "Bearer " + tokenDe(RANGEL, RANGEL_PASSWORD))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("nombre", "Alimentos", "disponible", 5, "requerido", 100))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("CENTRO_NO_REGISTRADO"));
    }

    @Test
    @DisplayName("Retirar 12 de 20 con el despacho existente deja 8")
    void retiraUnidadesConElDespacho() throws Exception {
        String token = tokenDe(RANGEL, RANGEL_PASSWORD);
        UUID centroId = crearCentro(token, PREFIJO_PRUEBA + UUID.randomUUID());
        UUID aguaId = itemInventarioJpaRepository.findByCentroAcopioIdOrderByNombreAsc(centroId).stream()
                .filter(item -> item.getNombre().equals("Agua"))
                .map(ItemInventarioJpaEntity::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("item not created: Agua"));

        mockMvc.perform(post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("itemId", aguaId.toString(), "cantidad", 12))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disponible").value(8));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void postInvalido(String token, Map<String, Object> cuerpo) throws Exception {
        mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    /** Creates the caller's center with the default body and returns its id. */
    private UUID crearCentro(String token, String nombre) throws Exception {
        MvcResult resultado = mockMvc.perform(post(RUTA)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoCentro(nombre)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(resultado.getResponse().getContentAsString())
                .get("id").asText());
    }

    /** A center in Suba with two items: Agua 20/50 and Cobijas 0/30. */
    private String cuerpoCentro(String nombre) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "nombre", nombre,
                "ubicacion", Map.of("lat", 4.75d, "lng", -74.06d),
                "items", List.of(
                        Map.of("nombre", "Agua", "disponible", 20, "requerido", 50),
                        Map.of("nombre", "Cobijas", "disponible", 0, "requerido", 30))));
    }

    /** Removes the centers of this class and their items. */
    private void borrarCentrosDePrueba() {
        List<OrganizacionJpaEntity> centros = organizacionJpaRepository.findAll().stream()
                .filter(centro -> centro.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        for (OrganizacionJpaEntity centro : centros) {
            itemInventarioJpaRepository.deleteAll(
                    itemInventarioJpaRepository.findByCentroAcopioIdOrderByNombreAsc(centro.getId()));
        }
        organizacionJpaRepository.deleteAll(centros);
    }

    /** Logs in with real credentials and returns the issued token. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
