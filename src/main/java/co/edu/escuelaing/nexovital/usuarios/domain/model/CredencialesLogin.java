package co.edu.escuelaing.nexovital.usuarios.domain.model;

import java.util.Objects;

/**
 * Credenciales en texto plano tal como llegan en la petición. Solo viven en
 * memoria: la contraseña nunca se persiste ni se registra en el log.
 */
public record CredencialesLogin(String email, String password) {

    public CredencialesLogin {
        Objects.requireNonNull(email, "email es obligatorio");
        Objects.requireNonNull(password, "password es obligatorio");
    }
}
