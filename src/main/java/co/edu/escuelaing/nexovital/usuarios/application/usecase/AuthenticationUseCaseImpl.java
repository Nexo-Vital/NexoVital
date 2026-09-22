package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CuentaBloqueadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.CredencialesLogin;
import co.edu.escuelaing.nexovital.usuarios.domain.model.EstadoIntentos;
import co.edu.escuelaing.nexovital.usuarios.domain.model.SesionAuth;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.AuthenticationUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.EstadoIntentosPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.TokenPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

/**
 * Orquesta el login según la máquina de estados del bloqueo (diseño D5):
 * bloqueo → credenciales → contador → token.
 *
 * <p>Dos reglas que se leen juntas y conviene no romper:
 * <ul>
 *   <li>Estando bloqueada la cuenta, el intento se rechaza <b>sin evaluar la
 *       contraseña y sin incrementar el contador</b>. Si el contador siguiera
 *       subiendo durante la ventana, un atacante mantendría la cuenta
 *       bloqueada indefinidamente.</li>
 *   <li>Cuando la ventana expiró, el fallo siguiente vuelve a valer 1. El
 *       contador no es acumulativo entre ventanas.</li>
 * </ul>
 *
 * <p>El reloj se inyecta (diseño D8) para que la ventana de 5 minutos sea
 * verificable sin dormir la suite de pruebas.
 */
@Service
public class AuthenticationUseCaseImpl implements AuthenticationUseCase {

    /** Fallos consecutivos que disparan el bloqueo (diseño D5). */
    public static final int MAX_INTENTOS_FALLIDOS = 3;

    /** Duración de la ventana de bloqueo (diseño D5). */
    public static final Duration VENTANA_BLOQUEO = Duration.ofMinutes(5);

    private final UsuarioRepository usuarioRepository;
    private final EstadoIntentosPort estadoIntentosPort;
    private final PasswordEncoderPort passwordEncoderPort;
    private final TokenPort tokenPort;
    private final Clock clock;

    public AuthenticationUseCaseImpl(UsuarioRepository usuarioRepository,
                                     EstadoIntentosPort estadoIntentosPort,
                                     PasswordEncoderPort passwordEncoderPort,
                                     TokenPort tokenPort,
                                     Clock clock) {
        this.usuarioRepository = usuarioRepository;
        this.estadoIntentosPort = estadoIntentosPort;
        this.passwordEncoderPort = passwordEncoderPort;
        this.tokenPort = tokenPort;
        this.clock = clock;
    }

    @Override
    public SesionAuth login(CredencialesLogin credenciales) {
        String email = normalizarEmail(credenciales.email());
        Usuario usuario = usuarioRepository.buscarPorEmail(email)
                .orElseThrow(() -> new UsuarioNoEncontradoException(email));

        Instant ahora = Instant.now(clock);
        EstadoIntentos estado = estadoIntentosPort.buscar(usuario.getId())
                .orElseGet(EstadoIntentos::inicial);

        if (estado.bloqueadoEn(ahora)) {
            // D5: sin evaluar la contraseña y sin tocar el contador.
            throw new CuentaBloqueadaException(segundosRestantes(estado.bloqueadoHasta(), ahora));
        }

        if (estado.bloqueoExpiradoEn(ahora)) {
            // D5: la ventana ya expiró; el conteo arranca de nuevo.
            estadoIntentosPort.reiniciar(usuario.getId());
        }

        if (!passwordEncoderPort.coincide(credenciales.password(), usuario.getPasswordHash())) {
            EstadoIntentos trasFallo = estadoIntentosPort.registrarFallo(
                    usuario.getId(), ahora.plus(VENTANA_BLOQUEO), MAX_INTENTOS_FALLIDOS);
            // La decisión de bloquear se tomó dentro del UPDATE atómico (D6).
            // Aquí solo se lee el resultado persistido para elegir entre 423 y 401.
            if (trasFallo.bloqueadoEn(ahora)) {
                throw new CuentaBloqueadaException(segundosRestantes(trasFallo.bloqueadoHasta(), ahora));
            }
            throw new CredencialesInvalidasException();
        }

        // Login exitoso: invariante 4 del modelo (intentos = 0, bloqueado_hasta = NULL).
        estadoIntentosPort.reiniciar(usuario.getId());
        return new SesionAuth(tokenPort.generar(usuario.getId()), usuario);
    }

    @Override
    public Usuario validarToken(String token) {
        if (!tokenPort.validar(token)) {
            throw new CredencialesInvalidasException();
        }
        UUID usuarioId = tokenPort.extraerSubject(token);
        return usuarioRepository.buscarPorId(usuarioId)
                .orElseThrow(() -> new UsuarioNoEncontradoException(usuarioId));
    }

    /**
     * El email es la clave de búsqueda del login (invariante 5), por lo que se
     * normaliza antes de tocar la base.
     */
    private static String normalizarEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Segundos restantes redondeados hacia arriba (para no anunciar 0 mientras
     * la cuenta sigue bloqueada) y acotados a la ventana máxima.
     */
    private static long segundosRestantes(Instant bloqueadoHasta, Instant ahora) {
        long millis = Duration.between(ahora, bloqueadoHasta).toMillis();
        long segundos = (long) Math.ceil(millis / 1000.0d);
        return Math.max(1L, Math.min(segundos, VENTANA_BLOQUEO.toSeconds()));
    }
}
