package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaEntity;
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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** EP-04.F2.US11: la solicitud atendida sale de las activas y aparece como atendida. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudAtendidasHttpTest extends SolicitudHttpTestSupport {

    @Autowired
    private SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;

    @Autowired
    private ExpirarSolicitudesVencidasUseCase expirarSolicitudesVencidasUseCase;

    private final List<UUID> solicitudesExtra = new ArrayList<>();
    private final List<UUID> usuariosExtra = new ArrayList<>();

    @AfterEach
    void borrarExtras() {
        solicitudJpaRepository.deleteAllById(solicitudesExtra);
        solicitudesExtra.clear();
        usuarioJpaRepository.deleteAllById(usuariosExtra);
        usuariosExtra.clear();
    }

    /** {@code GET /api/v1/solicitudes/mias}, with {@code ?estado=} when given; expects 200. */
    private JsonNode mias(String token, String estado) throws Exception {
        var peticion = get("/api/v1/solicitudes/mias").header("Authorization", "Bearer " + token);
        if (estado != null) {
            peticion = peticion.param("estado", estado);
        }
        MvcResult result = mockMvc.perform(peticion).andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private static JsonNode buscar(JsonNode lista, UUID solicitudId) {
        for (JsonNode solicitud : lista) {
            if (solicitudId.toString().equals(solicitud.get("id").asText())) {
                return solicitud;
            }
        }
        return null;
    }

    private static int posicion(JsonNode lista, UUID solicitudId) {
        for (int i = 0; i < lista.size(); i++) {
            if (solicitudId.toString().equals(lista.get(i).get("id").asText())) {
                return i;
            }
        }
        return -1;
    }

    /** Raises a request and runs the whole service: accept, arrival and finish. */
    private UUID servicioAtendido(String ciudadano, Conductor conductor, String token) throws Exception {
        UUID solicitudId = idDe(crearSolicitud(ciudadano));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());
        responder("llegada", solicitudId, conductor, token).andExpect(status().isOk());
        responder("finalizar", solicitudId, conductor, token).andExpect(status().isOk());
        return solicitudId;
    }

    @Test
    @DisplayName("A1: al finalizar, la solicitud sale de las activas y aparece como atendida")
    void a1_laAtendidaCambiaDeLista() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());
        responder("llegada", solicitudId, conductor, token).andExpect(status().isOk());

        assertNotNull(buscar(mias(ciudadano, null), solicitudId), "antes de finalizar es activa");
        assertNull(buscar(mias(ciudadano, "atendidas"), solicitudId), "y todavía no es atendida");

        responder("finalizar", solicitudId, conductor, token).andExpect(status().isOk());

        assertNull(buscar(mias(ciudadano, null), solicitudId), "deja de figurar como activa");
        assertNull(buscar(mias(ciudadano, "activas"), solicitudId), "también con ?estado=activas");
        JsonNode atendida = buscar(mias(ciudadano, "atendidas"), solicitudId);
        assertNotNull(atendida, "aparece entre las atendidas");
        assertEquals("TOMADA", atendida.get("estado").asText());
        assertEquals(conductor.unidad().toString(), atendida.get("ambulanciaAsignadaId").asText());
        assertTrue(atendida.hasNonNull("llegadaEn"), "conserva la hora de llegada");
    }

    @Test
    @DisplayName("A2: una solicitud activa, cancelada o vencida no aparece como atendida")
    void a2_soloLasFinalizadasSonAtendidas() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();

        UUID activa = idDe(crearSolicitud(ciudadano));
        UUID cancelada = idDe(crearSolicitud(ciudadano));
        mockMvc.perform(post("/api/v1/solicitudes/{id}/cancelar", cancelada)
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isOk());
        UUID vencida = solicitarAmbulanciaUseCase.solicitar(4.73d, -74.08d, null, null, zona,
                usuarioDe(CIUDADANO).getId(), clock.instant().minusSeconds(60)).getId();
        solicitudesExtra.add(vencida);
        expirarSolicitudesVencidasUseCase.expirarVencidas();

        JsonNode atendidas = mias(ciudadano, "atendidas");
        assertNull(buscar(atendidas, activa), "la activa no");
        assertNull(buscar(atendidas, cancelada), "la cancelada no");
        assertNull(buscar(atendidas, vencida), "la vencida no");
        for (JsonNode solicitud : atendidas) {
            assertEquals("TOMADA", solicitud.get("estado").asText(), "solo hay atendidas");
        }
    }

    @Test
    @DisplayName("A3: cada ciudadano ve solo sus atendidas; conductor 403, sin sesión 401, estado inválido 400")
    void a3_aislamientoYPermisos() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = servicioAtendido(tokenCiudadano(), conductor, token);

        UUID otroId = UUID.randomUUID();
        String email = "otro-ciudadano-" + otroId + "@nexovital.co";
        usuarioJpaRepository.save(new UsuarioJpaEntity(otroId, "Otro ciudadano", email,
                passwordEncoderPort.encriptar("otro123"), RolUsuario.CIUDADANO));
        usuariosExtra.add(otroId);
        JsonNode delOtro = mias(tokenDe(email, "otro123"), "atendidas");
        assertNull(buscar(delOtro, solicitudId), "otro ciudadano no ve la atendida");
        assertEquals(0, delOtro.size(), "un ciudadano sin servicios recibe una lista vacía");

        mockMvc.perform(get("/api/v1/solicitudes/mias").param("estado", "atendidas")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/solicitudes/mias").param("estado", "atendidas"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/solicitudes/mias").param("estado", "canceladas")
                        .header("Authorization", "Bearer " + tokenCiudadano()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    @Test
    @DisplayName("A4: con varias atendidas, la más reciente va primero")
    void a4_laMasRecienteVaPrimero() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        String ciudadano = tokenCiudadano();
        UUID primera = servicioAtendido(ciudadano, conductor, token);
        Thread.sleep(5);
        UUID segunda = servicioAtendido(ciudadano, conductor, token);

        JsonNode atendidas = mias(ciudadano, "atendidas");
        assertTrue(posicion(atendidas, primera) >= 0 && posicion(atendidas, segunda) >= 0);
        assertTrue(posicion(atendidas, segunda) < posicion(atendidas, primera), "la más reciente va primero");
    }
}
