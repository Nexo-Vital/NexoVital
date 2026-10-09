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

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** EP-04.F2.US9: the citizen reads their active requests and sees the declared arrival. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudMiasHttpTest extends SolicitudHttpTestSupport {

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

    /** {@code GET /api/v1/solicitudes/mias} with the given token; expects 200. */
    private JsonNode mias(String token) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/solicitudes/mias")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    /** The request with that id in the list, or null when it is not there. */
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

    private static Instant alMilisegundo(JsonNode instante) {
        return Instant.parse(instante.asText()).truncatedTo(ChronoUnit.MILLIS);
    }

    @Test
    @DisplayName("M1: el ciudadano sigue su solicitud y ve la llegada con la hora registrada")
    void m1_elCiudadanoVeLaLlegada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenConductor = tokenDe(conductor);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));

        JsonNode pendiente = buscar(mias(ciudadano), solicitudId);
        assertNotNull(pendiente, "la solicitud recién creada aparece entre las suyas");
        assertEquals("PENDIENTE", pendiente.get("estado").asText());
        assertFalse(pendiente.hasNonNull("llegadaEn"));

        responder("accept", solicitudId, conductor, tokenConductor).andExpect(status().isOk());
        JsonNode asignada = buscar(mias(ciudadano), solicitudId);
        assertEquals("ASIGNADA", asignada.get("estado").asText());
        assertEquals(conductor.unidad().toString(), asignada.get("ambulanciaAsignadaId").asText());
        assertFalse(asignada.hasNonNull("llegadaEn"), "sin llegada declarada no hay hora");

        MvcResult llegada = responder("llegada", solicitudId, conductor, tokenConductor)
                .andExpect(status().isOk())
                .andReturn();
        JsonNode declarada = objectMapper.readTree(llegada.getResponse().getContentAsString());
        JsonNode conLlegada = buscar(mias(ciudadano), solicitudId);
        assertEquals("ASIGNADA", conLlegada.get("estado").asText());
        assertTrue(conLlegada.hasNonNull("llegadaEn"), "el ciudadano ve que la ambulancia llegó");
        assertEquals(alMilisegundo(declarada.get("llegadaEn")), alMilisegundo(conLlegada.get("llegadaEn")),
                "con la misma hora que registró el servidor");

        mockMvc.perform(post("/api/v1/solicitudes/{id}/confirmar", solicitudId)
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isOk());
        JsonNode confirmada = buscar(mias(ciudadano), solicitudId);
        assertEquals("CONFIRMADA", confirmada.get("estado").asText());
        assertTrue(confirmada.hasNonNull("llegadaEn"));

        responder("finalizar", solicitudId, conductor, tokenConductor).andExpect(status().isOk());
        assertNull(buscar(mias(ciudadano), solicitudId), "un servicio cerrado ya no es activo");
    }

    @Test
    @DisplayName("M2: otro ciudadano no ve la solicitud; un conductor recibe 403 y sin sesión 401")
    void m2_soloElSolicitanteLaVe() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        UUID otroId = UUID.randomUUID();
        String email = "otro-ciudadano-" + otroId + "@nexovital.co";
        usuarioJpaRepository.save(new UsuarioJpaEntity(otroId, "Otro ciudadano", email,
                passwordEncoderPort.encriptar("otro123"), RolUsuario.CIUDADANO));
        usuariosExtra.add(otroId);

        JsonNode delOtro = mias(tokenDe(email, "otro123"));
        assertNull(buscar(delOtro, solicitudId), "cada ciudadano solo ve sus solicitudes");
        assertEquals(0, delOtro.size(), "un ciudadano sin solicitudes recibe una lista vacía");

        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        mockMvc.perform(get("/api/v1/solicitudes/mias")
                        .header("Authorization", "Bearer " + tokenDe(conductor)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/solicitudes/mias"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("M3: una solicitud cancelada o vencida ya no aparece entre las activas")
    void m3_cerradasNoAparecen() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();

        UUID cancelada = idDe(crearSolicitud(ciudadano));
        mockMvc.perform(post("/api/v1/solicitudes/{id}/cancelar", cancelada)
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isOk());

        UUID solicitanteId = usuarioDe(CIUDADANO).getId();
        UUID vencida = solicitarAmbulanciaUseCase.solicitar(4.73d, -74.08d, null, null, zona,
                solicitanteId, clock.instant().minusSeconds(60)).getId();
        solicitudesExtra.add(vencida);
        expirarSolicitudesVencidasUseCase.expirarVencidas();

        JsonNode activas = mias(ciudadano);
        assertNull(buscar(activas, cancelada), "la cancelada no aparece");
        assertNull(buscar(activas, vencida), "la vencida no aparece");
    }

    @Test
    @DisplayName("M4: con varias solicitudes activas, la más reciente va primero")
    void m4_laMasRecienteVaPrimero() throws Exception {
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();
        UUID primera = idDe(crearSolicitud(ciudadano));
        Thread.sleep(5);
        UUID segunda = idDe(crearSolicitud(ciudadano));

        JsonNode activas = mias(ciudadano);
        assertTrue(posicion(activas, segunda) >= 0 && posicion(activas, primera) >= 0);
        assertTrue(posicion(activas, segunda) < posicion(activas, primera), "la más reciente va primero");
    }
}
