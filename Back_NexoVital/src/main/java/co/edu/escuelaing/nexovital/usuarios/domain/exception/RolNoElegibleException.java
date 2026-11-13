package co.edu.escuelaing.nexovital.usuarios.domain.exception;

import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;

/**
 * Se pidió un rol que no se puede elegir al registrarse. Administrador de
 * plataforma y de acopio nunca se autoasignan (matriz de permisos, sección 4).
 */
public class RolNoElegibleException extends RuntimeException {

    public RolNoElegibleException(RolUsuario rol) {
        super("El rol " + rol + " no se puede elegir al registrarse.");
    }
}
