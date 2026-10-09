package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.SolicitudAbiertaPushListener.SolicitudAbiertaPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DetectarSenalPerdidaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * EP-04.F2.US1 — a unit that becomes able to receive requests is offered the
 * ones that are still open.
 *
 * <p>A request is broadcast once, to the units that are candidates at that
 * instant. A unit that was busy, out of service, disconnected or without signal
 * is left out; when it becomes eligible while the request is still PENDIENTE and
 * inside its window, the server adds it to the notified units and pushes the
 * request to its driver. The request keeps its ORIGINAL deadline.
 *
 * <p>Nothing changes for a request that is no longer open (accepted, expired),
 * nor for a unit that is still not eligible.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class OfertaTardiaHttpTest extends SolicitudHttpTestSupport {

    @Autowired
    private ReportarPosicionUseCase reportarPosicionUseCase;

    @Autowired
    private DetectarSenalPerdidaUseCase detectarSenalPerdidaUseCase;

    @Test
    @DisplayName("Al finalizar su servicio, la unidad recibe la solicitud que se abrió mientras estaba ocupada, con su vencimiento original")
    void alFinalizarRecibeLaSolicitudAbierta() throws Exception {
        Conductor amb1 = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        Conductor amb2 = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token1 = tokenDe(amb1);
        String ciudadano = tokenCiudadano();

        // Citizen 1 asks and amb1 accepts.
        UUID primera = idDe(crearSolicitud(ciudadano));
        responder("accept", primera, amb1, token1).andExpect(status().isOk());
        // A service is finished only after its arrival (EP-04.F2.US8).
        responder("llegada", primera, amb1, token1).andExpect(status().isOk());

        // Citizen 2 asks while amb1 is busy: only amb2 is notified.
        JsonNode segunda = crearSolicitud(ciudadano);
        UUID segundaId = idDe(segunda);
        assertTrue(notificadasDe(segunda).contains(amb2.unidad()));
        assertFalse(notificadasDe(segunda).contains(amb1.unidad()),
                "una unidad ocupada no recibe la solicitud cuando se crea");
        assertEquals(0, vecesNotificada(segundaId, amb1.unidad()));
        pushPortDePrueba.limpiar();

        // amb1 finishes its service and is available again.
        responder("finalizar", primera, amb1, token1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("TOMADA"));

        assertEquals(1, vecesNotificada(segundaId, amb1.unidad()),
                "la unidad liberada queda entre las notificadas de la solicitud abierta");
        List<SolicitudAbiertaPushPayload> ofertas = ofertasTardiasDe(amb1, segundaId);
        assertEquals(1, ofertas.size(), "el conductor recibe la solicitud abierta una vez");
        SolicitudAbiertaPushPayload oferta = ofertas.get(0);
        assertEquals("PENDIENTE", oferta.estado());
        assertNotNull(oferta.ubicacion(), "la oferta lleva el punto de recogida");
        assertTrue(oferta.ambulanciasNotificadas().contains(amb1.unidad()));
        assertTrue(oferta.ambulanciasNotificadas().contains(amb2.unidad()));
        // The window is not restarted: the deadline is the one the request was
        // created with.
        assertTrue(esElMismoInstante(segunda.get("timeoutEn").asText(), oferta.timeoutEn()),
                "la solicitud conserva su vencimiento original: " + oferta.timeoutEn());
        assertTrue(esElMismoInstante(segunda.get("solicitadaEn").asText(), oferta.solicitadaEn()),
                "y el instante en que se pidió: " + oferta.solicitadaEn());
        assertTrue(pendientesDe(token1).contains(segundaId),
                "la consola también la encuentra al leer sus pendientes");

        // And it is a real offer: amb1 can take it, and amb2 is told.
        responder("accept", segundaId, amb1, token1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ganador").value(true))
                .andExpect(jsonPath("$.solicitud.ambulanciaAsignadaId").value(amb1.unidad().toString()));
        assertEquals(1, framesDe(amb2, segundaId, "ASIGNADA").size(),
                "la otra unidad sabe de inmediato que la solicitud fue tomada");
    }

    @Test
    @DisplayName("Una solicitud que ya venció no se ofrece a la unidad que queda disponible")
    void unaSolicitudVencidaNoSeOfrece() throws Exception {
        Conductor amb1 = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token1 = tokenDe(amb1);
        String ciudadano = tokenCiudadano();
        UUID primera = idDe(crearSolicitud(ciudadano));
        responder("accept", primera, amb1, token1).andExpect(status().isOk());
        // A service is finished only after its arrival (EP-04.F2.US8).
        responder("llegada", primera, amb1, token1).andExpect(status().isOk());
        UUID segunda = idDe(crearSolicitud(ciudadano));
        pushPortDePrueba.limpiar();

        // The window of the second request closes before amb1 is free.
        clock.avanzar(Duration.ofDays(1));
        responder("finalizar", primera, amb1, token1).andExpect(status().isOk());

        assertEquals(0, vecesNotificada(segunda, amb1.unidad()),
                "una solicitud vencida no gana unidades notificadas");
        assertTrue(ofertasTardiasDe(amb1, segunda).isEmpty(), "ni se le envía al conductor");
        assertFalse(pendientesDe(token1).contains(segunda));
    }

    @Test
    @DisplayName("Una solicitud que ya fue aceptada no se ofrece a la unidad que queda disponible")
    void unaSolicitudYaAceptadaNoSeOfrece() throws Exception {
        Conductor fuera = sembrarConductor(EstadoAmbulancia.MANTENIMIENTO);
        Conductor otro = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        responder("accept", solicitudId, otro, tokenDe(otro)).andExpect(status().isOk());
        pushPortDePrueba.limpiar();

        declararDisponibilidad(true, tokenDe(fuera)).andExpect(status().isOk());

        assertEquals(0, vecesNotificada(solicitudId, fuera.unidad()));
        assertTrue(ofertasTardiasDe(fuera, solicitudId).isEmpty());
    }

    @Test
    @DisplayName("Al pasar de Fuera de servicio a Disponible, la unidad recibe la solicitud que sigue abierta")
    void alVolverADisponibleRecibeLaSolicitudAbierta() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.MANTENIMIENTO);
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        JsonNode creada = crearSolicitud(tokenCiudadano());
        assertFalse(notificadasDe(creada).contains(conductor.unidad()));
        pushPortDePrueba.limpiar();

        declararDisponibilidad(true, token).andExpect(status().isOk());

        assertEquals(1, vecesNotificada(idDe(creada), conductor.unidad()));
        assertEquals(1, ofertasTardiasDe(conductor, idDe(creada)).size());
        assertTrue(pendientesDe(token).contains(idDe(creada)));
    }

    @Test
    @DisplayName("Al conectarse, la unidad recibe la solicitud que se abrió mientras estaba desconectada")
    void alConectarseRecibeLaSolicitudAbierta() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        comandoDeMiUnidad("desconectar", token).andExpect(status().isOk());
        JsonNode creada = crearSolicitud(tokenCiudadano());
        assertFalse(notificadasDe(creada).contains(conductor.unidad()));
        pushPortDePrueba.limpiar();

        comandoDeMiUnidad("conectar", token).andExpect(status().isOk());

        assertEquals(1, vecesNotificada(idDe(creada), conductor.unidad()));
        assertEquals(1, ofertasTardiasDe(conductor, idDe(creada)).size());
        assertTrue(pendientesDe(token).contains(idDe(creada)));
    }

    @Test
    @DisplayName("Al recuperar la señal, la unidad recibe la solicitud que se abrió mientras no la tenía")
    void alRecuperarLaSenalRecibeLaSolicitudAbierta() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String ciudadano = tokenCiudadano();
        // The unit reports once and then goes silent for longer than the
        // threshold: the sweep marks it without signal.
        reportarPosicionUseCase.reportarPosicion(
                conductor.unidad(), conductor.id(), 4.74d, -74.09d, null, FuentePosicion.DEVICE);
        clock.avanzar(Duration.ofSeconds(60));
        detectarSenalPerdidaUseCase.detectar();
        assertTrue(unidadEnBase(conductor.unidad()).isSinSenal(), "la unidad quedó sin señal");

        JsonNode creada = crearSolicitud(ciudadano);
        assertFalse(notificadasDe(creada).contains(conductor.unidad()),
                "una unidad sin señal no recibe la solicitud cuando se crea");
        pushPortDePrueba.limpiar();

        reportarPosicionUseCase.reportarPosicion(
                conductor.unidad(), conductor.id(), 4.75d, -74.09d, null, FuentePosicion.DEVICE);

        assertFalse(unidadEnBase(conductor.unidad()).isSinSenal(), "el reporte devuelve la señal");
        assertEquals(1, vecesNotificada(idDe(creada), conductor.unidad()));
        assertEquals(1, ofertasTardiasDe(conductor, idDe(creada)).size());
    }

    @Test
    @DisplayName("Una unidad que se conecta pero sigue fuera de servicio no recibe la solicitud abierta")
    void unaUnidadQueSigueSinSerElegibleNoRecibeNada() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.MANTENIMIENTO);
        desconectarEnBase(conductor.unidad());
        sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        pushPortDePrueba.limpiar();

        comandoDeMiUnidad("conectar", tokenDe(conductor)).andExpect(status().isOk());

        assertEquals(0, vecesNotificada(solicitudId, conductor.unidad()),
                "conectada pero fuera de servicio: sigue sin ser candidata");
        assertTrue(ofertasTardiasDe(conductor, solicitudId).isEmpty());
    }

    @Test
    @DisplayName("Una unidad que ya estaba notificada no se agrega dos veces ni recibe la solicitud como nueva")
    void unaUnidadYaNotificadaNoSeDuplica() throws Exception {
        Conductor conductor = sembrarConductor(EstadoAmbulancia.DISPONIBLE);
        String token = tokenDe(conductor);
        UUID solicitudId = idDe(crearSolicitud(tokenCiudadano()));
        assertEquals(1, vecesNotificada(solicitudId, conductor.unidad()));
        pushPortDePrueba.limpiar();

        comandoDeMiUnidad("desconectar", token).andExpect(status().isOk());
        comandoDeMiUnidad("conectar", token).andExpect(status().isOk());

        assertEquals(1, vecesNotificada(solicitudId, conductor.unidad()),
                "la unidad sigue apareciendo una sola vez");
        assertTrue(ofertasTardiasDe(conductor, solicitudId).isEmpty(),
                "la solicitud que ya tenía la recupera leyendo sus pendientes, no como una oferta nueva");
        assertTrue(pendientesDe(token).contains(solicitudId));
    }

    /**
     * Two ISO instants that name the same moment. The response of the creation
     * carries the instant as the JVM produced it and the offer carries it as the
     * database stored it, so they may differ below the millisecond.
     */
    private static boolean esElMismoInstante(String esperado, String obtenido) {
        long diferencia = Duration.between(Instant.parse(esperado), Instant.parse(obtenido)).toMillis();
        return Math.abs(diferencia) <= 1;
    }
}
