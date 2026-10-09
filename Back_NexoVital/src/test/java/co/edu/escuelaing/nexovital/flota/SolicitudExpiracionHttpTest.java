package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.support.MutableClock;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US6 — a request nobody answered expires, seen from the outside
 * (HTTP and pushes), with two or more drivers.
 *
 * <p>The rule: the accept window is ONE per request and the SERVER fixes it.
 * When it closes with no winner, the request leaves every notified driver at
 * once, nobody is occupied, and the units stay free for the next request. A
 * request still inside its window is never touched by the expiry of another.
 *
 * <p>The scheduled sweep is off in the test profile, so the use case is driven
 * directly. An already expired request is built through the use case with a
 * deadline in the past (the HTTP layer never accepts one), relative to the
 * controllable clock that the sweep reads.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudExpiracionHttpTest extends SolicitudHttpTestSupport {

    @Autowired
    private ExpirarSolicitudesVencidasUseCase expirarSolicitudesVencidasUseCase;

    @Autowired
    private SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;

    @Autowired
    private MutableClock clock;

    private final List<UUID> solicitudesDeEstaPrueba = new ArrayList<>();

    @BeforeEach
    void fijarReloj() {
        clock.fijar(TestClockConfig.INSTANTE_BASE);
    }

    @AfterEach
    void borrarSolicitudes() {
        solicitudJpaRepository.deleteAllById(solicitudesDeEstaPrueba);
        solicitudesDeEstaPrueba.clear();
    }

    /** A PENDIENTE request whose window closed a minute before the controllable clock. */
    private UUID crearSolicitudVencida() {
        Instant pasado = clock.instant().minusSeconds(60);
        UUID id = solicitarAmbulanciaUseCase.solicitar(
                4.73d, -74.08d, UUID.randomUUID(), UUID.randomUUID(), zona, UUID.randomUUID(), pasado).getId();
        solicitudesDeEstaPrueba.add(id);
        return id;
    }

    @Test
    @DisplayName("E1: el servidor fija el vencimiento; el valor que mande el cliente se ignora")
    void e1_elClienteNoFijaElVencimiento() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenCiudadano();
        Instant antes = Instant.now();

        // A browser with a clock one hour behind would ask for a window that is already closed.
        MvcResult result = mockMvc.perform(post("/api/v1/solicitudes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "ubicacion", Map.of("lat", 4.73d, "lng", -74.08d),
                                "zonaId", zona,
                                "timeoutEn", antes.minusSeconds(3600).toString()))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andReturn();
        JsonNode creada = objectMapper.readTree(result.getResponse().getContentAsString());
        solicitudesDeEstaPrueba.add(idDe(creada));

        Instant timeoutEn = Instant.parse(creada.get("timeoutEn").asText());
        assertTrue(timeoutEn.isAfter(antes.plusSeconds(30)) && timeoutEn.isBefore(antes.plusSeconds(120)),
                "el vencimiento es la ventana configurada contada desde el reloj del servidor: " + timeoutEn);

        // Not expired: the driver still has it among the open ones.
        assertTrue(pendientesDe(tokenDe(conductor)).contains(idDe(creada)));
    }

    @Test
    @DisplayName("E2: al vencer sin respuesta, la solicitud sale de todos los conductores y ninguno puede aceptarla")
    void e2_laSolicitudVencidaSaleDeTodos() throws Exception {
        Conductor uno = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor dos = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = crearSolicitudVencida();

        int expiradas = expirarSolicitudesVencidasUseCase.expirarVencidas();

        assertTrue(expiradas >= 1);
        assertEquals(EstadoSolicitud.TIMEOUT,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
        for (Conductor conductor : List.of(uno, dos)) {
            String token = tokenDe(conductor);
            assertFalse(pendientesDe(token).contains(solicitudId),
                    "la solicitud vencida ya no se ofrece a ningún conductor");
            assertEquals(1, framesDe(conductor, solicitudId, "TIMEOUT").size(),
                    "cada conductor avisado recibe el aviso de que venció, una sola vez");
            responder("accept", solicitudId, conductor, token)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));
            assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado(),
                    "un accept sobre una solicitud vencida no ocupa la unidad");
        }
    }

    @Test
    @DisplayName("E3: vencer no es rechazar; las unidades siguen libres y atienden la solicitud siguiente")
    void e3_lasUnidadesSiguenLibresParaOtraSolicitud() throws Exception {
        Conductor uno = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor dos = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID vencida = crearSolicitudVencida();
        expirarSolicitudesVencidasUseCase.expirarVencidas();

        // Nobody declined it: expiry is a whole-request state, not a per-unit decline.
        MvcResult detalle = mockMvc.perform(get("/api/v1/solicitudes/{id}", vencida)
                        .header("Authorization", "Bearer " + tokenDe(uno)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TIMEOUT"))
                .andReturn();
        JsonNode leida = objectMapper.readTree(detalle.getResponse().getContentAsString());
        assertTrue(leida.get("ambulanciasRechazaron").isEmpty(), "vencer no registra rechazos");

        // The citizen asks again: both units are notified again and one of them wins.
        JsonNode nueva = crearSolicitud(tokenCiudadano());
        assertTrue(notificadasDe(nueva).contains(uno.unidad()));
        assertTrue(notificadasDe(nueva).contains(dos.unidad()));
        responder("accept", idDe(nueva), dos, tokenDe(dos))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.estado").value("ASIGNADA"));
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(dos.unidad()).getEstado());
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(uno.unidad()).getEstado());
    }

    @Test
    @DisplayName("E4: la expiración de una solicitud no toca a otra que sigue dentro de su ventana")
    void e4_otraSolicitudVigenteNoSeAfecta() throws Exception {
        Conductor uno = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor dos = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        JsonNode vigente = crearSolicitud(tokenCiudadano());
        UUID vencida = crearSolicitudVencida();

        expirarSolicitudesVencidasUseCase.expirarVencidas();

        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(idDe(vigente)).orElseThrow().getEstado());
        for (Conductor conductor : List.of(uno, dos)) {
            var pendientes = pendientesDe(tokenDe(conductor));
            assertTrue(pendientes.contains(idDe(vigente)), "la vigente sigue disponible");
            assertFalse(pendientes.contains(vencida), "la vencida ya no");
            assertTrue(framesDe(conductor, idDe(vigente), "TIMEOUT").isEmpty(),
                    "nadie recibe aviso de vencimiento de la vigente");
        }
        responder("accept", idDe(vigente), uno, tokenDe(uno)).andExpect(status().isOk());
    }
}
