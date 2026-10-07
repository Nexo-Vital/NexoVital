package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaEntity;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US4 — accepting a request through {@code POST
 * /api/v1/solicitudes/{id}/accept}, as the drivers do it.
 *
 * <p>The two scenarios of the story, at the HTTP layer:
 * <ol>
 *   <li>one driver accepts a request notified to four units and wins it: the
 *       request is assigned to that unit, the unit is busy, and the request
 *       disappears for the other three;</li>
 *   <li>several drivers accept at the same time: exactly one wins and every
 *       other one is told at once that the request is already assigned.</li>
 * </ol>
 *
 * <p>{@link SolicitudConcurrenciaTest} proves the same guarantee against the
 * use case. This class proves it where the client sees it: status, error code
 * and message.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudAceptarHttpTest extends SolicitudHttpTestSupport {

    /** The story's scenario: a request notified to four ambulances. */
    private static final int CONDUCTORES = 4;

    /** Rounds of the simultaneous accept, to sample distinct interleavings. */
    private static final int RONDAS = 5;

    /** Generous window so contention for the row is never the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    /** What every notified unit that did not win reads. */
    private static final String MENSAJE_YA_ASIGNADA = "Solicitud ya asignada a otra ambulancia.";

    /** The answer one driver got to its accept. */
    private record Respuesta(Conductor conductor, int estado, JsonNode cuerpo) {
    }

    // -----------------------------------------------------------------------
    // Scenario 1: one driver accepts and wins
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("A1: con 4 unidades notificadas, quien acepta queda asignado, su unidad ocupada y la solicitud desaparece de las otras 3")
    void a1_unConductorAceptaYLaGana() throws Exception {
        List<Conductor> conductores = sembrarConductores(CONDUCTORES);
        List<String> tokens = tokensDe(conductores);
        JsonNode creada = crearSolicitud(tokenCiudadano());
        UUID solicitudId = idDe(creada);
        for (Conductor conductor : conductores) {
            assertTrue(notificadasDe(creada).contains(conductor.unidad()),
                    "las cuatro unidades de la prueba deben estar entre las notificadas");
        }

        Conductor ganador = conductores.get(0);
        responder("accept", solicitudId, ganador, tokens.get(0))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.id").value(solicitudId.toString()))
                .andExpect(jsonPath("$.solicitud.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(ganador.unidad().toString()));

        // I am assigned and my ambulance is busy.
        SolicitudJpaEntity enBase = solicitudJpaRepository.findById(solicitudId).orElseThrow();
        assertEquals(EstadoSolicitud.ASIGNADA, enBase.getEstado());
        assertEquals(ganador.unidad(), enBase.getAmbulanciaAsignadaId());
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(ganador.unidad()).getEstado(),
                "la unidad que aceptó pasa a ocupada");

        // The request disappears for the other three: each one is told once that
        // it is taken, none of them can still answer it, and they stay available.
        for (int i = 1; i < conductores.size(); i++) {
            Conductor otro = conductores.get(i);
            List<SolicitudPushPayload> avisos = framesDe(otro, solicitudId, "ASIGNADA");
            assertEquals(1, avisos.size(), "cada unidad que no ganó recibe un aviso, y solo uno");
            assertEquals(ganador.unidad(), avisos.get(0).ambulanciaAsignadaId(),
                    "el aviso dice qué unidad tiene la solicitud");
            assertFalse(pendientesDe(tokens.get(i)).contains(solicitudId),
                    "la solicitud ya no está entre las que esa unidad puede responder");
            assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(otro.unidad()).getEstado(),
                    "las demás unidades siguen disponibles");
        }
    }

    // -----------------------------------------------------------------------
    // Scenario 2: several drivers accept at the same time
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("A2: 4 conductores aceptan a la vez → un solo 200; los demás reciben 409 con \"ya asignada\" y siguen disponibles")
    void a2_aceptacionSimultaneaUnSoloGanador() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(CONDUCTORES);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                List<Conductor> conductores = sembrarConductores(CONDUCTORES);
                List<String> tokens = tokensDe(conductores);
                UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

                List<Respuesta> respuestas = aceptarALaVez(pool, solicitudId, conductores, tokens);

                List<Respuesta> ganadores = respuestas.stream()
                        .filter(respuesta -> respuesta.estado() == 200)
                        .toList();
                assertEquals(1, ganadores.size(),
                        "ronda " + ronda + ": exactamente un conductor gana: " + describir(respuestas));
                Conductor ganador = ganadores.get(0).conductor();
                assertTrue(ganadores.get(0).cuerpo().get("ganador").asBoolean());
                assertEquals(ganador.unidad().toString(),
                        ganadores.get(0).cuerpo().get("solicitud").get("ambulanciaAsignadaId").asText());

                // Every other driver is told at once that it is already assigned:
                // a 409, never a 500, with one of the two "lost" codes.
                for (Respuesta respuesta : respuestas) {
                    if (respuesta.conductor().equals(ganador)) {
                        continue;
                    }
                    assertEquals(409, respuesta.estado(),
                            "ronda " + ronda + ": quien no gana recibe 409: " + describir(respuestas));
                    String codigo = respuesta.cuerpo().get("codigo").asText();
                    assertTrue("CAS_PERDIDO".equals(codigo) || "SOLICITUD_NO_ASIGNABLE".equals(codigo),
                            "ronda " + ronda + ": código inesperado para quien pierde: " + codigo);
                    assertEquals(MENSAJE_YA_ASIGNADA, respuesta.cuerpo().get("mensaje").asText(),
                            "ronda " + ronda + ": quien pierde lee que la solicitud ya fue asignada");
                    assertEquals(EstadoAmbulancia.DISPONIBLE,
                            unidadEnBase(respuesta.conductor().unidad()).getEstado(),
                            "ronda " + ronda + ": la unidad que pierde no queda ocupada");
                }

                // The server agrees: one request, one unit.
                SolicitudJpaEntity enBase = solicitudJpaRepository.findById(solicitudId).orElseThrow();
                assertEquals(EstadoSolicitud.ASIGNADA, enBase.getEstado(), "ronda " + ronda);
                assertEquals(ganador.unidad(), enBase.getAmbulanciaAsignadaId(),
                        "ronda " + ronda + ": la solicitud es de quien recibió el 200");
                assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(ganador.unidad()).getEstado(),
                        "ronda " + ronda + ": la unidad ganadora queda ocupada");

                // And the request disappears from the losers' screens.
                for (int i = 0; i < conductores.size(); i++) {
                    Conductor conductor = conductores.get(i);
                    if (conductor.equals(ganador)) {
                        continue;
                    }
                    assertEquals(1, framesDe(conductor, solicitudId, "ASIGNADA").size(),
                            "ronda " + ronda + ": quien pierde recibe el aviso de que fue tomada");
                    assertFalse(pendientesDe(tokens.get(i)).contains(solicitudId),
                            "ronda " + ronda + ": la solicitud ya no se le ofrece a quien perdió");
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // -----------------------------------------------------------------------
    // The reason a late accept reads
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("A3: quien acepta después de que otra unidad ganó recibe 409 con \"ya asignada\"")
    void a3_aceptarTardeDiceYaAsignada() throws Exception {
        Conductor ganador = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor tardio = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("accept", solicitudId, ganador, tokenDe(ganador)).andExpect(status().isOk());

        responder("accept", solicitudId, tardio, tokenDe(tardio))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"))
                .andExpect(jsonPath("$.mensaje").value(MENSAJE_YA_ASIGNADA));

        assertEquals(ganador.unidad(),
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getAmbulanciaAsignadaId(),
                "el intento tardío no cambia de quién es la solicitud");
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(tardio.unidad()).getEstado());
    }

    @Test
    @DisplayName("A4: aceptar una solicitud cancelada responde 409 sin decir que fue asignada a otra ambulancia")
    void a4_aceptarCanceladaNoDiceYaAsignada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));

        mockMvc.perform(post("/api/v1/solicitudes/{id}/cancelar", solicitudId)
                        .header("Authorization", "Bearer " + ciudadano))
                .andExpect(status().isOk());

        MvcResult result = responder("accept", solicitudId, conductor, tokenDe(conductor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"))
                .andReturn();

        // Nobody has it: the reason must not claim another ambulance does.
        String mensaje = objectMapper.readTree(result.getResponse().getContentAsString())
                .get("mensaje").asText();
        assertNotEquals(MENSAJE_YA_ASIGNADA, mensaje);
        assertEquals(EstadoSolicitud.CANCELADA,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private List<Conductor> sembrarConductores(int cuantos) {
        List<Conductor> conductores = new ArrayList<>();
        for (int i = 0; i < cuantos; i++) {
            conductores.add(sembrarConductor(EstadoAmbulancia.DISPONIBLE));
        }
        return conductores;
    }

    /** One session per driver, opened before the race so the login is not part of it. */
    private List<String> tokensDe(List<Conductor> conductores) throws Exception {
        List<String> tokens = new ArrayList<>();
        for (Conductor conductor : conductores) {
            tokens.add(tokenDe(conductor));
        }
        return tokens;
    }

    /**
     * Every driver sends its accept at the same instant. Each thread waits at
     * the gate with its request ready, so the calls really overlap: a
     * sequential loop would pass even with the guarantee broken.
     */
    private List<Respuesta> aceptarALaVez(ExecutorService pool, UUID solicitudId,
                                          List<Conductor> conductores, List<String> tokens) throws Exception {
        CountDownLatch listos = new CountDownLatch(conductores.size());
        CountDownLatch largada = new CountDownLatch(1);
        List<Future<Respuesta>> futuros = new ArrayList<>();
        for (int i = 0; i < conductores.size(); i++) {
            Conductor conductor = conductores.get(i);
            String token = tokens.get(i);
            Callable<Respuesta> intento = () -> {
                listos.countDown();
                largada.await();
                MvcResult result = responder("accept", solicitudId, conductor, token).andReturn();
                return new Respuesta(conductor, result.getResponse().getStatus(),
                        objectMapper.readTree(result.getResponse().getContentAsString()));
            };
            futuros.add(pool.submit(intento));
        }
        assertTrue(listos.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS),
                "los conductores deben estar listos antes de la largada");
        largada.countDown();

        List<Respuesta> respuestas = new ArrayList<>();
        for (Future<Respuesta> futuro : futuros) {
            respuestas.add(futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS));
        }
        return respuestas;
    }

    private static String describir(List<Respuesta> respuestas) {
        List<String> lineas = new ArrayList<>();
        for (Respuesta respuesta : respuestas) {
            lineas.add(respuesta.estado() + " " + respuesta.cuerpo());
        }
        return lineas.toString();
    }
}
