package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.FlotaPushPayload;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.SolicitudPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** EP-04.F2.US10: finalizar libera la unidad una sola vez y vuelve a recibir solicitudes. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudFinalizarHttpTest extends SolicitudHttpTestSupport {

    /** Request accepted, arrived and confirmed by the citizen: ready to finish. */
    private UUID servicioListoParaFinalizar(Conductor conductor, String token) throws Exception {
        String ciudadano = tokenCiudadano();
        UUID solicitudId = idDe(crearSolicitud(ciudadano));
        responder("accept", solicitudId, conductor, token).andExpect(status().isOk());
        responder("llegada", solicitudId, conductor, token).andExpect(status().isOk());
        confirmarLlegada(solicitudId, ciudadano).andExpect(status().isOk());
        return solicitudId;
    }

    private EstadoSolicitud estadoEnBase(UUID solicitudId) {
        return solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado();
    }

    /** How many DISPONIBLE frames /topic/flota carried for the unit. */
    private long liberacionesEnFlota(UUID unidad) {
        return pushPortDePrueba.publicaciones().stream()
                .filter(publicacion -> FlotaPushListener.DESTINO_FLOTA.equals(publicacion.destino()))
                .map(PublicacionCapturada::payload)
                .filter(payload -> payload instanceof FlotaPushPayload flota
                        && unidad.equals(flota.ambulanciaId())
                        && "DISPONIBLE".equals(flota.estado()))
                .count();
    }

    /** How many TOMADA frames the citizen received for the request. */
    private long cierresAlCiudadano(UUID solicitudId) throws Exception {
        String ciudadanoId = usuarioDe(CIUDADANO).getId().toString();
        return pushPortDePrueba.haciaUsuario(ciudadanoId, FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .map(PublicacionCapturada::payload)
                .filter(payload -> payload instanceof SolicitudPushPayload solicitud
                        && solicitudId.equals(solicitud.solicitudId())
                        && "TOMADA".equals(solicitud.estado()))
                .count();
    }

    @Test
    @DisplayName("F1: la unidad liberada recibe la solicitud nueva y puede tomarla")
    void f1_laUnidadLiberadaRecibeSolicitudesNuevas() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID primera = servicioListoParaFinalizar(conductor, token);
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado());

        responder("finalizar", primera, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TOMADA"));
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado());
        pushPortDePrueba.limpiar();

        JsonNode segunda = crearSolicitud(tokenCiudadano());
        UUID segundaId = idDe(segunda);
        assertTrue(notificadasDe(segunda).contains(conductor.unidad()),
                "la unidad liberada queda entre las notificadas de la solicitud nueva");
        assertTrue(recibioSolicitudNueva(conductor, segundaId), "el conductor recibe el aviso en vivo");
        assertTrue(pendientesDe(token).contains(segundaId), "y la ve entre sus pendientes");

        responder("accept", segundaId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(conductor.unidad().toString()));
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado());
    }

    @Test
    @DisplayName("F2: finalizar otra vez responde 409 y no libera la unidad que ya tomó otro servicio")
    void f2_finalizarRepetidoNoLiberaLaNuevaMision() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID primera = servicioListoParaFinalizar(conductor, token);
        responder("finalizar", primera, conductor, token).andExpect(status().isOk());

        UUID segunda = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", segunda, conductor, token).andExpect(status().isOk());
        pushPortDePrueba.limpiar();

        responder("finalizar", primera, conductor, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ASIGNABLE"));

        assertEquals(EstadoSolicitud.TOMADA, estadoEnBase(primera));
        assertEquals(EstadoSolicitud.ASIGNADA, estadoEnBase(segunda), "la misión nueva sigue activa");
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado(),
                "el cierre repetido no libera la unidad");
        assertEquals(0, liberacionesEnFlota(conductor.unidad()), "ni publica una liberación falsa");
        assertEquals(0, cierresAlCiudadano(primera), "ni avisa otra vez al ciudadano");
    }

    @Test
    @DisplayName("F3: varios finalizar simultáneos: uno gana, los demás 409, una sola liberación")
    void f3_finalizarSimultaneo() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = servicioListoParaFinalizar(conductor, token);
        pushPortDePrueba.limpiar();

        int hilos = 6;
        CountDownLatch largada = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(hilos);
        int ganadores = 0;
        try {
            List<Future<MvcResult>> resultados = new ArrayList<>();
            for (int i = 0; i < hilos; i++) {
                Callable<MvcResult> llamada = () -> {
                    largada.await();
                    return responder("finalizar", solicitudId, conductor, token).andReturn();
                };
                resultados.add(pool.submit(llamada));
            }
            largada.countDown();

            for (Future<MvcResult> resultado : resultados) {
                MvcResult respuesta = resultado.get(30, TimeUnit.SECONDS);
                int codigo = respuesta.getResponse().getStatus();
                String cuerpo = respuesta.getResponse().getContentAsString();
                if (codigo == 200) {
                    ganadores++;
                } else {
                    assertEquals(409, codigo, "el perdedor recibe 409, nunca 500: " + cuerpo);
                }
            }
        } finally {
            pool.shutdownNow();
        }

        assertEquals(1, ganadores, "solo un finalizar cierra el servicio");
        assertEquals(EstadoSolicitud.TOMADA, estadoEnBase(solicitudId));
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado());
        assertEquals(1, liberacionesEnFlota(conductor.unidad()), "la flota ve una sola liberación");
        assertEquals(1, cierresAlCiudadano(solicitudId), "el ciudadano recibe un solo cierre");
    }

    @Test
    @DisplayName("F4: si la unidad ya no está en misión, no se cierra la solicitud ni se avisa nada")
    void f4_sinUnidadEnMisionSeRevierteTodo() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = servicioListoParaFinalizar(conductor, token);
        jdbcTemplate.update("UPDATE ambulancias SET estado = 'MANTENIMIENTO' WHERE id = '" + conductor.unidad() + "'");
        pushPortDePrueba.limpiar();

        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("AMBULANCIA_NO_DISPONIBLE"));

        assertEquals(EstadoSolicitud.CONFIRMADA, estadoEnBase(solicitudId), "la solicitud no queda cerrada sin su unidad");
        assertEquals(EstadoAmbulancia.MANTENIMIENTO, unidadEnBase(conductor.unidad()).getEstado());
        assertEquals(0, liberacionesEnFlota(conductor.unidad()));
        assertEquals(0, cierresAlCiudadano(solicitudId));

        // Con la unidad de nuevo en misión, el reintento cierra normalmente.
        jdbcTemplate.update("UPDATE ambulancias SET estado = 'EN_MISION' WHERE id = '" + conductor.unidad() + "'");
        responder("finalizar", solicitudId, conductor, token)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TOMADA"));
        assertEquals(EstadoAmbulancia.DISPONIBLE, unidadEnBase(conductor.unidad()).getEstado());
    }

    @Test
    @DisplayName("F5: sin sesión 401, ciudadano 403, solicitud inexistente 404 y sin unidad 400")
    void f5_rechazosDeFinalizar() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = servicioListoParaFinalizar(conductor, token);
        String cuerpo = objectMapper.writeValueAsString(
                Map.of("ambulanciaId", conductor.unidad().toString()));

        mockMvc.perform(post("/api/v1/solicitudes/{id}/finalizar", solicitudId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/v1/solicitudes/{id}/finalizar", solicitudId)
                        .header("Authorization", "Bearer " + tokenCiudadano())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ACCESO_DENEGADO"));

        responder("finalizar", UUID.randomUUID(), conductor, token)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.codigo").value("SOLICITUD_NO_ENCONTRADA"));

        mockMvc.perform(post("/api/v1/solicitudes/{id}/finalizar", solicitudId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));

        assertEquals(EstadoSolicitud.CONFIRMADA, estadoEnBase(solicitudId), "ningún rechazo cierra el servicio");
        assertEquals(EstadoAmbulancia.EN_MISION, unidadEnBase(conductor.unidad()).getEstado());
        assertFalse(liberacionesEnFlota(conductor.unidad()) > 0, "ni libera la unidad");
    }
}
