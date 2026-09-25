package co.edu.escuelaing.nexovital.usuarios;

import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.application.usecase.OrganizacionPushListener;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaEntity;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.OrganizacionJpaRepository;
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

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Prueba de la emisión del evento de centro (EP-01.F2.US1, tarea 245): al
 * registrar una organización, el módulo {@code usuarios} publica el payload en
 * {@code /topic/map.events} <b>después del commit</b>, espejo de la emergencia.
 *
 * <p><b>Enfoque elegido:</b> se inyecta un doble del {@code PushPort}
 * ({@link PushPortDePrueba}, marcado {@code @Primary}) que captura cada
 * publicación, en vez de abrir una sesión STOMP real. Motivo: lo que hay que
 * probar aquí es <b>qué publica {@code usuarios}</b> (destino y payload), no
 * cómo el canal lo transporta — el transporte end-to-end ya está probado en
 * {@code CanalTiempoRealDosSesionesTest.S5}. El doble hace la aserción
 * determinista sobre el destino exacto y cada campo del payload, sin depender
 * del broker ni de tiempos de red.
 *
 * <p>El {@code AFTER_COMMIT} es real (el POST pasa por una transacción de
 * verdad): si la publicación ocurriera antes del commit, el doble no vería nada.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class OrganizacionEmisionTest extends LoginTestBase {

    private static final String ADMIN_PLATAFORMA = "admin@nexovital.co";
    private static final String ADMIN_PLATAFORMA_PASSWORD = "admin123";

    private static final String PREFIJO_PRUEBA = "Emision OR-8 ";

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    @Autowired
    private OrganizacionJpaRepository organizacionJpaRepository;

    /** Cada test parte del registro en cero y no deja filas creadas. */
    @AfterEach
    void limpiar() {
        pushPortDePrueba.limpiar();
        List<OrganizacionJpaEntity> aBorrar = organizacionJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        organizacionJpaRepository.deleteAll(aBorrar);
    }

    @Test
    @DisplayName("registrar una organización publica el evento de centro en /topic/map.events tras el commit")
    void alRegistrarUnaOrganizacionPublicaElEventoDeCentro() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();

        MvcResult resultado = mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "nombre", nombre,
                                "tipo", "CENTRO_AYUDA",
                                "zonaId", "Suba",
                                "ubicacion", Map.of("lat", 4.61d, "lng", -74.09d)))))
                .andExpect(status().isCreated())
                .andReturn();

        String idEsperado = objectMapper.readTree(resultado.getResponse().getContentAsString())
                .get("id").asText();

        // El evento se publica DESPUÉS del commit; con la transacción real ya
        // cerrada, el doble debe haber capturado exactamente una publicación.
        PublicacionCapturada publicacion = pushPortDePrueba.ultimaHacia(OrganizacionPushListener.DESTINO_MAPA);
        assertNotNull(publicacion,
                "registrar una organización debe publicar en " + OrganizacionPushListener.DESTINO_MAPA);

        // El sobre de D4: `type` y el elemento ADENTRO. El front lee
        // `payload.type` y `payload.elemento`, asi que un payload plano no
        // actualizaria el mapa.
        Map<String, Object> elemento = elementoDe(publicacion);
        assertEquals("CENTRO", elemento.get("clase"));
        assertEquals(idEsperado, elemento.get("id").toString());
        assertEquals(nombre, elemento.get("nombre"));
        assertEquals("CENTRO_AYUDA", elemento.get("tipo").toString());
        assertEquals("Suba", elemento.get("zonaId"));
        assertNotNull(elemento.get("ubicacion"), "el elemento debe traer la ubicación del centro");
    }

    @Test
    @DisplayName("una organización sin zonaId publica el evento con zonaId nulo")
    void organizacionSinZonaPublicaElEventoConZonaNula() throws Exception {
        String token = tokenDe(ADMIN_PLATAFORMA, ADMIN_PLATAFORMA_PASSWORD);
        String nombre = PREFIJO_PRUEBA + UUID.randomUUID();

        mockMvc.perform(post("/api/v1/organizaciones")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "nombre", nombre,
                                "tipo", "CENTRO_ACOPIO",
                                "ubicacion", Map.of("lat", 4.62d, "lng", -74.08d)))))
                .andExpect(status().isCreated());

        PublicacionCapturada publicacion = pushPortDePrueba.ultimaHacia(OrganizacionPushListener.DESTINO_MAPA);
        assertNotNull(publicacion, "debe publicarse el evento del centro aunque no tenga zona");

        Map<String, Object> elemento = elementoDe(publicacion);
        assertEquals("CENTRO", elemento.get("clase"));
        assertEquals(nombre, elemento.get("nombre"));
        assertTrue(elemento.containsKey("zonaId"), "el elemento declara la clave zonaId");
        assertEquals(null, elemento.get("zonaId"), "sin zona enviada, el evento debe traer zonaId nulo");
    }

    /**
     * Lee el elemento que va DENTRO del sobre de D4: el consumidor lo busca en
     * {@code payload.elemento}. Afirma tambien que el sobre declare el tipo del
     * evento, para que back y front no se separen de forma silenciosa.
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> elementoDe(PublicacionCapturada publicacion) {
        Map<String, Object> payload = PushPortDePrueba.comoMapa(publicacion);
        assertEquals(OrganizacionPushListener.TIPO_ELEMENTO_UPSERT, payload.get("type"),
                "el payload debe declarar el tipo del evento (diseno US2 D4)");
        Object elemento = payload.get("elemento");
        assertNotNull(elemento, "el payload envuelve al elemento en 'elemento' (diseno US2 D4)");
        return (Map<String, Object>) elemento;
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
