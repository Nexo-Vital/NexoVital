package co.edu.escuelaing.nexovital.limites.application;

import co.edu.escuelaing.nexovital.limites.domain.model.RecursoLimitado;
import co.edu.escuelaing.nexovital.limites.domain.model.VeredictoLimite;
import co.edu.escuelaing.nexovital.limites.domain.port.out.ContadorSolicitudesPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * Decide si una solicitud pasa el límite.
 *
 * <p>Se aplican dos ventanas independientes y la más restrictiva gana:
 *
 * <ul>
 *   <li><b>Por usuario</b>: 10 por minuto. Un ciudadano reporta una emergencia
 *       como mucho cada dos minutos; 10 deja 20 veces de margen sobre el uso
 *       legítimo y corta el script que dispara en bucle.</li>
 *   <li><b>Por IP</b>: 60 por minuto. El límite por IP es más alto a propósito:
 *       una sala de operaciones entera puede salir por una sola IP pública
 *       (NAT), así que acotarlo a 10 bloquearía a gente real. Su función no es
 *       limitar el uso normal, es frenar un origen que rota usuarios.</li>
 * </ul>
 *
 * <p>Los dos valores son configurables para poder probarlos sin generar sesenta
 * solicitudes en un test.
 */
@Service
public class LimitadorDeSolicitudes {

    /** Tamaño de la ventana. Fija a un minuto: es lo que el escenario promete. */
    private static final Duration VENTANA = Duration.ofMinutes(1);

    private static final String PREFIJO_USUARIO = "u:";
    private static final String PREFIJO_IP = "ip:";

    private final ContadorSolicitudesPort contador;
    private final int porMinutoUsuario;
    private final int porMinutoIp;

    public LimitadorDeSolicitudes(ContadorSolicitudesPort contador,
                                  @Value("${nexovital.limites.usuario-por-minuto:10}") int porMinutoUsuario,
                                  @Value("${nexovital.limites.ip-por-minuto:60}") int porMinutoIp) {
        this.contador = contador;
        this.porMinutoUsuario = porMinutoUsuario;
        this.porMinutoIp = porMinutoIp;
    }

    /**
     * Registra la solicitud y dice si puede seguir.
     *
     * <p>Registrar es parte de evaluar: si primero se decidiera y después se
     * contara, dos instancias podrían decidir "permitido" con el mismo contador.
     */
    public VeredictoLimite evaluar(RecursoLimitado recurso, UUID usuarioId, String ip, Instant ahora) {
        if (usuarioId != null) {
            long delUsuario = contador.registrar(claveUsuario(usuarioId, recurso), ahora, VENTANA);
            if (delUsuario > porMinutoUsuario) {
                return VeredictoLimite.rechazado(segundosDeEspera());
            }
        }
        if (ip != null && !ip.isBlank()) {
            long deLaIp = contador.registrar(claveIp(ip, recurso), ahora, VENTANA);
            if (deLaIp > porMinutoIp) {
                return VeredictoLimite.rechazado(segundosDeEspera());
            }
        }
        return VeredictoLimite.pasa();
    }

    /**
     * Segundos hasta que la ventana se libere. Se informa la ventana completa
     * como cota superior: la fila arranca cuando llega la primera solicitud, no
     * en un minuto exacto del reloj, así que prometer menos sería mentir.
     */
    private static long segundosDeEspera() {
        return VENTANA.toSeconds();
    }

    private static String claveUsuario(UUID usuarioId, RecursoLimitado recurso) {
        return PREFIJO_USUARIO + usuarioId + ":" + recurso.name();
    }

    private static String claveIp(String ip, RecursoLimitado recurso) {
        return PREFIJO_IP + ip + ":" + recurso.name();
    }
}
