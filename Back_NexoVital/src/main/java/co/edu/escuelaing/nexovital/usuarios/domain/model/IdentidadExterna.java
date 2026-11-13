package co.edu.escuelaing.nexovital.usuarios.domain.model;

/**
 * Lo que el proveedor de identidad externo (Google, vía Firebase) afirma sobre
 * quien presenta el token, ya verificado (firma, emisor, audiencia y
 * expiración).
 *
 * <p>El nombre y el correo salen de aquí y nunca del cuerpo de la petición: un
 * cliente no puede registrarse con un correo que Google no le confirmó.
 *
 * @param uid             identificador del usuario en el IdP (el {@code sub})
 * @param email           correo de la cuenta; puede ser {@code null} si el IdP no lo envía
 * @param emailVerificado {@code true} si el IdP confirmó que el correo es de quien inicia sesión
 * @param nombre          nombre visible de la cuenta; puede ser {@code null}
 */
public record IdentidadExterna(String uid, String email, boolean emailVerificado, String nombre) {
}
