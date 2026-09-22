package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.port.out.PasswordEncoderPort;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Hash BCrypt. Las contraseñas del catálogo demo se persisten únicamente como
 * hash; el texto plano solo existe en memoria (diseño D2).
 */
@Component
public class PasswordEncoderAdapter implements PasswordEncoderPort {

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    @Override
    public String encriptar(String password) {
        return encoder.encode(password);
    }

    @Override
    public boolean coincide(String password, String hash) {
        return encoder.matches(password, hash);
    }
}
