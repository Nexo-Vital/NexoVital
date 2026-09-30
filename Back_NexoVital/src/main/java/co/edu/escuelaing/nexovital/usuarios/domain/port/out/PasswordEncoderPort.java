package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

/**
 * Puerto de salida de hashing de contraseñas. El dominio no conoce BCrypt.
 */
public interface PasswordEncoderPort {

    String encriptar(String password);

    boolean coincide(String password, String hash);
}
