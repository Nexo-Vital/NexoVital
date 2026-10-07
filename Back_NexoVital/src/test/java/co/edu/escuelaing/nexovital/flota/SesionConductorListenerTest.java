package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.ConexionPushListener.ConexionPushPayload;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.GestionarConexionUnidadUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.SesionConductorListener;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * EP-04.F2.US1 — a driver who closes the console is disconnected by the server
 * (design D4, scenarios S10 to S12).
 *
 * <p>The rule is switched off in the test profile, so that the tests that open
 * and close STOMP sessions do not disconnect units behind other tests. Here the
 * listener is built by hand with the rule ON, wired to the real use case and
 * the real database, and it receives the same session events the broker
 * publishes.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SesionConductorListenerTest {

    @Autowired
    private GestionarConexionUnidadUseCase gestionarConexionUnidadUseCase;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private SesionConductorListener listener;
    private final List<UUID> unidades = new ArrayList<>();

    @BeforeEach
    void preparar() {
        listener = new SesionConductorListener(gestionarConexionUnidadUseCase, true);
        pushPortDePrueba.limpiar();
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(unidades);
        unidades.clear();
        pushPortDePrueba.limpiar();
    }

    @Test
    @DisplayName("S10: al cerrarse la única sesión de un conductor disponible, su unidad queda desconectada y sale un frame")
    void s10_cerrarLaUnicaSesionDesconectaLaUnidad() {
        Usuario conductor = conductor();
        UUID unidad = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductor.getId());

        listener.alAbrirSesion(sesionAbierta("sesion-1", conductor));
        assertTrue(unidadEnBase(unidad).isConectada(), "abrir la sesión no cambia nada");

        listener.alCerrarSesion(sesionCerrada("sesion-1", conductor));

        assertFalse(unidadEnBase(unidad).isConectada(), "la unidad queda desconectada");
        PublicacionCapturada flota = pushPortDePrueba.ultimaHacia(FlotaPushListener.DESTINO_FLOTA);
        assertTrue(flota != null && flota.payload() instanceof ConexionPushPayload,
                "la desconexión se propaga por /topic/flota");
        ConexionPushPayload frame = (ConexionPushPayload) flota.payload();
        assertEquals(unidad, frame.ambulanciaId());
        assertFalse(frame.conectada());
    }

    @Test
    @DisplayName("S11: con dos sesiones abiertas, cerrar una no desconecta; cerrar la última sí")
    void s11_laUnidadSigueConectadaMientrasQuedeUnaSesion() {
        Usuario conductor = conductor();
        UUID unidad = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductor.getId());
        listener.alAbrirSesion(sesionAbierta("sesion-1", conductor));
        listener.alAbrirSesion(sesionAbierta("sesion-2", conductor));

        listener.alCerrarSesion(sesionCerrada("sesion-1", conductor));
        assertTrue(unidadEnBase(unidad).isConectada(),
                "queda otra pestaña abierta: la unidad sigue conectada");

        listener.alCerrarSesion(sesionCerrada("sesion-2", conductor));
        assertFalse(unidadEnBase(unidad).isConectada(),
                "al cerrarse la última sesión la unidad queda desconectada");
    }

    @Test
    @DisplayName("S12: cerrar la sesión de un conductor en misión no lo desconecta ni cambia su estado")
    void s12_cerrarLaSesionEnMisionNoDesconecta() {
        Usuario conductor = conductor();
        UUID unidad = sembrarUnidad(EstadoAmbulancia.EN_MISION, conductor.getId());
        listener.alAbrirSesion(sesionAbierta("sesion-1", conductor));

        listener.alCerrarSesion(sesionCerrada("sesion-1", conductor));

        AmbulanciaJpaEntity actual = unidadEnBase(unidad);
        assertTrue(actual.isConectada(), "una unidad que atiende un servicio sigue conectada");
        assertEquals(EstadoAmbulancia.EN_MISION, actual.getEstado());
    }

    @Test
    @DisplayName("Cerrar la sesión de alguien que no es conductor no toca ninguna unidad")
    void laSesionDeOtroRolNoDesconectaNada() {
        Usuario conductor = conductor();
        UUID unidad = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductor.getId());
        // Same user id, but the session belongs to a citizen: it is not tracked.
        Usuario ciudadano = new Usuario(conductor.getId(), "Ciudadano de prueba",
                "ciudadano-" + conductor.getId() + "@nexovital.co", "hash", RolUsuario.CIUDADANO);

        listener.alAbrirSesion(sesionAbierta("sesion-1", ciudadano));
        listener.alCerrarSesion(sesionCerrada("sesion-1", ciudadano));

        assertTrue(unidadEnBase(unidad).isConectada());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static Usuario conductor() {
        UUID id = UUID.randomUUID();
        return new Usuario(id, "Conductor de prueba", "conductor-" + id + "@nexovital.co", "hash",
                RolUsuario.CONDUCTOR);
    }

    private UUID sembrarUnidad(EstadoAmbulancia estado, UUID conductorId) {
        UUID id = UUID.randomUUID();
        String placa = "S" + id.toString().substring(0, 7).toUpperCase();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, placa, estado, 4.73d, -74.08d, "PruebaSesion", conductorId));
        unidades.add(id);
        return id;
    }

    private AmbulanciaJpaEntity unidadEnBase(UUID unidad) {
        return ambulanciaJpaRepository.findById(unidad).orElseThrow();
    }

    /** The STOMP principal: the authentication whose principal is the user. */
    private static Authentication autenticacionDe(Usuario usuario) {
        return new UsernamePasswordAuthenticationToken(usuario, null, List.of());
    }

    private static Message<byte[]> mensajeDe(String sesionId) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.OTHER);
        accessor.setSessionId(sesionId);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private SessionConnectedEvent sesionAbierta(String sesionId, Usuario usuario) {
        return new SessionConnectedEvent(this, mensajeDe(sesionId), autenticacionDe(usuario));
    }

    private SessionDisconnectEvent sesionCerrada(String sesionId, Usuario usuario) {
        return new SessionDisconnectEvent(
                this, mensajeDe(sesionId), sesionId, CloseStatus.NORMAL, autenticacionDe(usuario));
    }
}
