package co.edu.escuelaing.nexovital.flota;

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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US5 — declining a request through {@code POST
 * /api/v1/solicitudes/{id}/reject}.
 *
 * <p>The story's scenario: a driver declines a request that was notified to
 * their ambulance; the request stays visible and available for the other
 * notified units, and the ambulance that declined stays available.
 *
 * <p>The rule this class adds: the decline is recorded. The unit that declined
 * keeps seeing the request while it is open, but can no longer accept it.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudRechazoHttpTest extends SolicitudHttpTestSupport {

    private static final String MENSAJE_YA_RECHAZADA = "Ya rechazaste esta solicitud.";

    /** Generous window so contention is never the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    // -----------------------------------------------------------------------
    // The story's scenario
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("R1: al rechazar, la solicitud sigue PENDIENTE y disponible para las demás, y mi ambulancia sigue disponible")
    void r1_rechazarDejaLaSolicitudDisponibleParaLasDemas() throws Exception {
        Conductor quienRechaza = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor otro = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenOtro = tokenDe(otro);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("reject", solicitudId, quienRechaza, tokenDe(quienRechaza))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(solicitudId.toString()))
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andExpect(jsonPath("$.ambulanciaAsignadaId").doesNotExist())
                .andExpect(jsonPath("$.ambulanciasRechazaron.length()").value(1))
                .andExpect(jsonPath("$.ambulanciasRechazaron[0]").value(quienRechaza.unidad().toString()));

        // The request itself did not move, and my ambulance stays available.
        SolicitudJpaEntity enBase = solicitudJpaRepository.findById(solicitudId).orElseThrow();
        assertEquals(EstadoSolicitud.PENDIENTE, enBase.getEstado());
        assertNull(enBase.getAmbulanciaAsignadaId());
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(quienRechaza.unidad()).getEstado(),
                "la ambulancia que rechaza permanece disponible");
        assertEquals(1, framesDe(quienRechaza, solicitudId, "RECHAZADA").size(),
                "solo quien rechaza recibe el aviso de su rechazo");
        assertTrue(framesDe(otro, solicitudId, "RECHAZADA").isEmpty(),
                "el rechazo de una unidad no se avisa a las demás");

        // Still visible and available for the other notified unit.
        assertTrue(pendientesDe(tokenOtro).contains(solicitudId),
                "la solicitud sigue visible para las demás unidades notificadas");
        responder("accept", solicitudId, otro, tokenOtro)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(otro.unidad().toString()));
    }

    // -----------------------------------------------------------------------
    // The decline is final for the unit that made it
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("R2: quien rechazó no puede aceptar después: 409 SOLICITUD_YA_RECHAZADA y la solicitud sigue abierta para las demás")
    void r2_quienRechazoNoPuedeAceptar() throws Exception {
        Conductor quienRechaza = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor otro = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(quienRechaza);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("reject", solicitudId, quienRechaza, token).andExpect(status().isOk());

        responder("accept", solicitudId, quienRechaza, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_YA_RECHAZADA"))
                .andExpect(jsonPath("$.mensaje").value(MENSAJE_YA_RECHAZADA));

        // The refused accept changed nothing.
        SolicitudJpaEntity enBase = solicitudJpaRepository.findById(solicitudId).orElseThrow();
        assertEquals(EstadoSolicitud.PENDIENTE, enBase.getEstado(),
                "el intento de quien rechazó no asigna la solicitud");
        assertNull(enBase.getAmbulanciaAsignadaId());
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(quienRechaza.unidad()).getEstado(),
                "la unidad que rechazó no queda ocupada");

        // And the rest can still take it.
        responder("accept", solicitudId, otro, tokenDe(otro))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true));
    }

    @Test
    @DisplayName("R3: quien rechazó sigue viendo la solicitud, marcada con su rechazo, en el detalle y entre sus pendientes")
    void r3_quienRechazoSigueViendoLaSolicitud() throws Exception {
        Conductor quienRechaza = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor otro = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(quienRechaza);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("reject", solicitudId, quienRechaza, token).andExpect(status().isOk());

        // The detail (EP-04.F2.US3) is still readable and says who declined.
        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andExpect(jsonPath("$.ambulanciasRechazaron.length()").value(1))
                .andExpect(jsonPath("$.ambulanciasRechazaron[0]").value(quienRechaza.unidad().toString()));

        // After a reload the console reads it back with the same mark, so it
        // lists the request without offering it again.
        assertEquals(Set.of(quienRechaza.unidad()), rechazaronSegunPendientes(solicitudId, token));

        // The other unit reads the same list: the mark is a fact of the request.
        assertEquals(Set.of(quienRechaza.unidad()), rechazaronSegunPendientes(solicitudId, tokenDe(otro)));
    }

    @Test
    @DisplayName("R4: rechazar dos veces responde 200 las dos, registra el rechazo una sola vez y avisa una sola vez")
    void r4_rechazarDosVecesEsIdempotente() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("reject", solicitudId, conductor, token).andExpect(status().isOk());
        responder("reject", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("PENDIENTE"))
                .andExpect(jsonPath("$.ambulanciasRechazaron.length()").value(1))
                .andExpect(jsonPath("$.ambulanciasRechazaron[0]").value(conductor.unidad().toString()));

        assertEquals(1, framesDe(conductor, solicitudId, "RECHAZADA").size(),
                "el segundo rechazo no cambia nada y no se vuelve a avisar");
        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
    }

    @Test
    @DisplayName("R5: rechazar una solicitud que otra unidad ya aceptó responde 409 y no registra el rechazo")
    void r5_rechazarUnaSolicitudYaAsignadaDevuelve409() throws Exception {
        Conductor ganador = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor tardio = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String tokenTardio = tokenDe(tardio);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        responder("accept", solicitudId, ganador, tokenDe(ganador)).andExpect(status().isOk());

        responder("reject", solicitudId, tardio, tokenTardio)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        mockMvc.perform(get("/api/v1/solicitudes/{id}", solicitudId)
                        .header("Authorization", "Bearer " + tokenTardio))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("ASIGNADA"))
                .andExpect(jsonPath("$.ambulanciasRechazaron.length()").value(0));
    }

    // -----------------------------------------------------------------------
    // Several units decline
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("R6: 4 conductores rechazan a la vez → los 4 reciben 200, los 4 quedan registrados y la solicitud sigue PENDIENTE")
    void r6_rechazosSimultaneosNoChocan() throws Exception {
        int cuantos = 4;
        List<Conductor> conductores = new ArrayList<>();
        List<String> tokens = new ArrayList<>();
        for (int i = 0; i < cuantos; i++) {
            Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
            conductores.add(conductor);
            tokens.add(tokenDe(conductor));
        }
        Conductor quienAcepta = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));

        ExecutorService pool = Executors.newFixedThreadPool(cuantos);
        List<Integer> estados = new ArrayList<>();
        try {
            CountDownLatch listos = new CountDownLatch(cuantos);
            CountDownLatch largada = new CountDownLatch(1);
            List<Future<Integer>> futuros = new ArrayList<>();
            for (int i = 0; i < cuantos; i++) {
                Conductor conductor = conductores.get(i);
                String token = tokens.get(i);
                Callable<Integer> intento = () -> {
                    listos.countDown();
                    largada.await();
                    return responder("reject", solicitudId, conductor, token)
                            .andReturn().getResponse().getStatus();
                };
                futuros.add(pool.submit(intento));
            }
            assertTrue(listos.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS),
                    "los conductores deben estar listos antes de la largada");
            largada.countDown();
            for (Future<Integer> futuro : futuros) {
                estados.add(futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS));
            }
        } finally {
            pool.shutdownNow();
        }

        // A decline never touches the request row, so none of them collides.
        assertEquals(List.of(200, 200, 200, 200), estados,
                "ningún rechazo simultáneo falla ni choca con otro");

        Set<UUID> esperadas = new HashSet<>();
        for (Conductor conductor : conductores) {
            esperadas.add(conductor.unidad());
        }
        String tokenQuienAcepta = tokenDe(quienAcepta);
        assertEquals(esperadas, rechazaronSegunPendientes(solicitudId, tokenQuienAcepta),
                "los cuatro rechazos quedan registrados");
        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado(),
                "que todas las demás rechacen no cierra la solicitud");

        // The one unit that did not decline can still take it.
        responder("accept", solicitudId, quienAcepta, tokenQuienAcepta)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Units that declined a request, as the pending-requests read of a driver
     * reports them. Fails when that driver's read does not list the request.
     */
    private Set<UUID> rechazaronSegunPendientes(UUID solicitudId, String token) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/flota/ambulancias/mia/solicitudes/pendientes")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode pendientes = objectMapper.readTree(result.getResponse().getContentAsString());
        for (JsonNode pendiente : pendientes) {
            if (solicitudId.toString().equals(pendiente.get("id").asText())) {
                Set<UUID> rechazaron = new HashSet<>();
                for (JsonNode unidad : pendiente.get("ambulanciasRechazaron")) {
                    rechazaron.add(UUID.fromString(unidad.asText()));
                }
                return rechazaron;
            }
        }
        throw new AssertionError("la solicitud " + solicitudId + " no está entre las pendientes del conductor");
    }
}
