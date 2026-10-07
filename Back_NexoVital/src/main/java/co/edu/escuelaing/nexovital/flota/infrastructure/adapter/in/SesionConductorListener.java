package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.flota.domain.port.in.GestionarConexionUnidadUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Disconnects a driver's unit when the driver's LAST realtime session ends
 * (EP-04.F2.US1, D4): closing the tab, reloading the page, logging out or
 * losing the network all end the STOMP session, and from the server they look
 * the same.
 *
 * <p><b>How it counts.</b> It keeps the open STOMP sessions of each driver. A
 * session is registered when the broker confirms it ({@code CONNECTED}) and
 * removed when it ends. The unit is disconnected only when the count reaches
 * zero, so a driver with two tabs stays connected while one remains.
 *
 * <p><b>Ending a session never connects.</b> Opening a session does not connect
 * the unit either: connecting is always an explicit command of the driver. After
 * a reload the new page reads its unit, sees it disconnected and offers
 * "Conectarse".
 *
 * <p><b>A unit in service stays connected.</b> The use case runs the same
 * conditional UPDATE as the manual command, which does not apply to a unit that
 * is attending a request.
 *
 * <p><b>In memory on purpose.</b> The sessions belong to this process: after a
 * restart there is no session left to count. Spring may publish the end of one
 * session more than once; removing the session from the map makes the second
 * notice a no-op.
 *
 * <p>The test profile turns it off with
 * {@code nexovital.flota.conexion.desconexion-por-sesion=false}, so a test that
 * opens and closes STOMP sessions does not disconnect a unit behind another
 * test's back.
 */
@Component
public class SesionConductorListener {

    private static final Logger LOG = LoggerFactory.getLogger(SesionConductorListener.class);

    private final GestionarConexionUnidadUseCase gestionarConexionUnidadUseCase;
    private final boolean habilitado;

    /** STOMP session id to the driver that owns it. Only driver sessions are kept. */
    private final Map<String, UUID> conductorPorSesion = new ConcurrentHashMap<>();
    /** Open STOMP sessions per driver. */
    private final Map<UUID, Integer> sesionesPorConductor = new ConcurrentHashMap<>();

    public SesionConductorListener(
            GestionarConexionUnidadUseCase gestionarConexionUnidadUseCase,
            @Value("${nexovital.flota.conexion.desconexion-por-sesion:true}") boolean habilitado) {
        this.gestionarConexionUnidadUseCase = gestionarConexionUnidadUseCase;
        this.habilitado = habilitado;
    }

    /** Registers the session of a driver once the broker confirmed it. */
    @EventListener
    public void alAbrirSesion(SessionConnectedEvent evento) {
        if (!habilitado) {
            return;
        }
        String sesionId = SimpMessageHeaderAccessor.getSessionId(evento.getMessage().getHeaders());
        UUID conductorId = conductorDe(evento.getUser());
        if (sesionId == null || conductorId == null) {
            return;
        }
        // putIfAbsent: a repeated notice of the same session must not count twice.
        if (conductorPorSesion.putIfAbsent(sesionId, conductorId) == null) {
            sesionesPorConductor.merge(conductorId, 1, Integer::sum);
        }
    }

    /** Removes the session and, if it was the driver's last one, disconnects the unit. */
    @EventListener
    public void alCerrarSesion(SessionDisconnectEvent evento) {
        if (!habilitado) {
            return;
        }
        UUID conductorId = conductorPorSesion.remove(evento.getSessionId());
        if (conductorId == null) {
            // Not a driver session, or its end was already handled.
            return;
        }
        // compute is atomic per key: the entry is removed when it reaches zero,
        // so `restantes == null` means this was the driver's last session.
        Integer restantes = sesionesPorConductor.compute(conductorId,
                (id, abiertas) -> abiertas == null || abiertas <= 1 ? null : abiertas - 1);
        if (restantes != null) {
            return;
        }
        try {
            if (gestionarConexionUnidadUseCase.desconectarPorCierreDeSesion(conductorId)) {
                LOG.info("Unidad desconectada por cierre de sesión del conductor {}", conductorId);
            }
        } catch (RuntimeException e) {
            // The end of a session must never fail the WebSocket container.
            LOG.warn("No fue posible desconectar la unidad del conductor {}", conductorId, e);
        }
    }

    /** The driver's user id, or {@code null} when the session is not a driver's. */
    private static UUID conductorDe(Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal() instanceof Usuario usuario
                && usuario.getRol() == RolUsuario.CONDUCTOR) {
            return usuario.getId();
        }
        return null;
    }
}
