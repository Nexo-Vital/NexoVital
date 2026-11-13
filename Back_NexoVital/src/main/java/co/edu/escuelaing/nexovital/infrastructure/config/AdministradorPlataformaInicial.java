package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.UUID;

/**
 * Deja creado el administrador de plataforma (EP-06.F2.US1, T10).
 *
 * <p>Ese rol no se puede elegir al registrarse, así que alguien tiene que
 * existir con él desde el arranque. Corre en todos los perfiles (también en
 * Azure, donde el seeder demo no corre) y es idempotente: si el correo ya
 * existe no hace nada.
 *
 * <p>Se crea sin cuenta de Google enlazada. La primera vez que esa persona entra
 * con Google, y Google confirma que el correo es suyo, {@code
 * ResolutorSesionFirebase} lo enlaza. La contraseña local es un hash de un valor
 * aleatorio que nadie conoce: el administrador solo entra con Google.
 *
 * <p>El correo sale de {@code nexovital.admin.email} (variable
 * {@code NEXOVITAL_ADMIN_EMAIL}). Vacío, no se crea nadie.
 */
@Component
public class AdministradorPlataformaInicial implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(AdministradorPlataformaInicial.class);

    private final UsuarioRepository usuarioRepository;
    private final PasswordEncoderPort passwordEncoderPort;
    private final String email;

    public AdministradorPlataformaInicial(UsuarioRepository usuarioRepository,
                                          PasswordEncoderPort passwordEncoderPort,
                                          @Value("${nexovital.admin.email:}") String email) {
        this.usuarioRepository = usuarioRepository;
        this.passwordEncoderPort = passwordEncoderPort;
        this.email = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    @Override
    public void run(ApplicationArguments args) {
        if (email.isEmpty()) {
            LOG.info("nexovital.admin.email vacío: no se precarga administrador de plataforma");
            return;
        }
        if (usuarioRepository.existePorEmail(email)) {
            LOG.info("Administrador de plataforma ya existe: {}", email);
            return;
        }
        usuarioRepository.guardar(new Usuario(
                UUID.randomUUID(),
                "Administrador de plataforma",
                email,
                passwordEncoderPort.encriptar(UUID.randomUUID().toString()),
                RolUsuario.ADMIN_PLATAFORMA));
        LOG.info("Administrador de plataforma precargado: {} (se enlaza al entrar con Google)", email);
    }
}
