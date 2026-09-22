package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Siembra el catálogo de usuarios precargados de demostración (diseño D2).
 *
 * <p>Dos barreras para que NUNCA corra en producción (diseño D3):
 * <ol>
 *   <li>{@code @Profile({"default", "docker", "test"})}: el perfil {@code prod}
 *       excluye el bean.</li>
 *   <li>{@code @ConditionalOnProperty(nexovital.seed.enabled=true)}: exige opt-in
 *       explícito, de modo que un despliegue que herede la configuración local
 *       tampoco lo active.</li>
 * </ol>
 *
 * <p>Idempotente (T8): cada usuario se inserta solo si su email no existe, así
 * que reiniciar la aplicación no duplica cuentas ni falla.
 *
 * <p>El log registra únicamente el email. La contraseña demo nunca se escribe
 * en el log ni en la base: se persiste solo como hash BCrypt.
 */
@Component
@Profile({"default", "docker", "test"})
@ConditionalOnProperty(name = "nexovital.seed.enabled", havingValue = "true")
public class DataSeeder implements CommandLineRunner {

    private static final Logger LOG = LoggerFactory.getLogger(DataSeeder.class);

    private static final String PASSWORD_CONDUCTOR = "conductor123";

    private record UsuarioSemilla(String nombre, String email, String password, RolUsuario rol) {
    }

    /**
     * Los 10 usuarios de demostración que cubren los 5 roles canónicos.
     * Un conductor por ambulancia para poder probar el broadcast de C2.
     */
    private static final List<UsuarioSemilla> CATALOGO = List.of(
            new UsuarioSemilla("Rangel Dev", "rangel@nexovital.co", "rangel123", RolUsuario.ADMIN_CENTRO_AYUDA),
            new UsuarioSemilla("Admin Plataforma", "admin@nexovital.co", "admin123", RolUsuario.ADMIN_PLATAFORMA),
            new UsuarioSemilla("Coordinación CRUE", "centro@nexovital.co", "centro123", RolUsuario.ADMIN_CENTRO_AYUDA),
            new UsuarioSemilla("Admin Acopio Bogotá", "acopio@nexovital.co", "acopio123", RolUsuario.ADMIN_ACOPIO),
            new UsuarioSemilla("Ciudadano Demo", "ciudadano@nexovital.co", "ciudadano123", RolUsuario.CIUDADANO),
            new UsuarioSemilla("Conductor ABC101", "conductor1@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC202", "conductor2@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC303", "conductor3@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC404", "conductor4@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR),
            new UsuarioSemilla("Conductor ABC505", "conductor5@nexovital.co", PASSWORD_CONDUCTOR, RolUsuario.CONDUCTOR));

    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoderPort passwordEncoderPort;

    public DataSeeder(UsuarioRepository usuarioRepository, PasswordEncoderPort passwordEncoderPort) {
        this.usuarioRepository = usuarioRepository;
        this.passwordEncoderPort = passwordEncoderPort;
    }

    @Override
    public void run(String... args) {
        int sembrados = 0;
        for (UsuarioSemilla semilla : CATALOGO) {
            if (usuarioRepository.existePorEmail(semilla.email())) {
                LOG.info("Usuario demo ya existe, seed omitido: {}", semilla.email());
                continue;
            }
            usuarioRepository.guardar(new Usuario(
                    UUID.randomUUID(),
                    semilla.nombre(),
                    semilla.email(),
                    passwordEncoderPort.encriptar(semilla.password()),
                    semilla.rol()));
            sembrados++;
            LOG.info("Usuario demo sembrado: {} (rol {})", semilla.email(), semilla.rol());
        }
        LOG.info("Seed de usuarios demo finalizado: {} nuevos de {} en el catálogo", sembrados, CATALOGO.size());
    }
}
