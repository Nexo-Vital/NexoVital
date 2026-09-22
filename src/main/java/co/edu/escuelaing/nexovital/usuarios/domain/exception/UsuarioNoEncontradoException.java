package co.edu.escuelaing.nexovital.usuarios.domain.exception;

import java.util.UUID;

/**
 * No existe una cuenta con el identificador buscado. En el login se traduce al
 * mismo {@code 401 CREDENCIALES_INVALIDAS} que una contraseña incorrecta: el
 * cliente no debe poder distinguir si el email existe (diseño D5).
 */
public class UsuarioNoEncontradoException extends RuntimeException {

    public UsuarioNoEncontradoException(String email) {
        super("Usuario no encontrado: " + email);
    }

    public UsuarioNoEncontradoException(UUID usuarioId) {
        super("Usuario no encontrado: " + usuarioId);
    }
}
