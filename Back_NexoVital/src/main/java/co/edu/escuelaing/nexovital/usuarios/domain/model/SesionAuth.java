package co.edu.escuelaing.nexovital.usuarios.domain.model;

import java.util.Objects;

/**
 * Resultado de un login exitoso: el token emitido y el usuario autenticado.
 */
public record SesionAuth(String token, Usuario usuario) {

    public SesionAuth {
        Objects.requireNonNull(token, "token es obligatorio");
        Objects.requireNonNull(usuario, "usuario es obligatorio");
    }
}
