package co.edu.escuelaing.nexovital.usuarios.domain.model;

import java.security.Principal;
import java.util.Objects;
import java.util.UUID;

/**
 * Agregado de identidad de un usuario. Inmutable y sin dependencias de
 * framework: no conoce Spring ni JPA (README.md, "Reglas de arquitectura").
 *
 * <p>El estado de intentos fallidos y de bloqueo <b>no</b> forma parte de este
 * agregado: es estado de autenticación, no de la identidad (diseño D4). Se
 * accede a él mediante {@code EstadoIntentosPort}.
 *
 * <p>Implementa {@link Principal} (JDK, no Spring) para fijar un nombre ESTABLE
 * de sesión: el JWT filter y el interceptor STOMP lo publican como Principal, y
 * el destino por usuario del broadcast C2 ({@code convertAndSendToUser}) exige
 * que {@code getName()} sea determinista. Sin esto, el nombre sería el
 * {@code toString()} por defecto del objeto, distinto en cada request, y el
 * broadcast no podría direccionar a un conductor. {@code getName()} devuelve el
 * id, que es la llave que {@code Ambulancia.conductorId} ya conoce.
 */
public final class Usuario implements Principal {

    private final UUID id;
    private final String nombre;
    private final String email;
    private final String passwordHash;
    private final RolUsuario rol;

    public Usuario(UUID id, String nombre, String email, String passwordHash, RolUsuario rol) {
        this.id = Objects.requireNonNull(id, "id es obligatorio");
        this.nombre = Objects.requireNonNull(nombre, "nombre es obligatorio");
        this.email = Objects.requireNonNull(email, "email es obligatorio");
        this.passwordHash = Objects.requireNonNull(passwordHash, "passwordHash es obligatorio");
        this.rol = Objects.requireNonNull(rol, "rol es obligatorio");
    }

    /**
     * Nombre estable de la sesión: el id del usuario. Es la llave con la que el
     * broadcast C2 direcciona una entrega a este conductor.
     */
    @Override
    public String getName() {
        return id.toString();
    }

    public UUID getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public String getEmail() {
        return email;
    }

    /**
     * Hash BCrypt de la contraseña. Nunca texto plano.
     */
    public String getPasswordHash() {
        return passwordHash;
    }

    public RolUsuario getRol() {
        return rol;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Usuario usuario)) {
            return false;
        }
        return id.equals(usuario.id) && email.equals(usuario.email);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, email);
    }
}
