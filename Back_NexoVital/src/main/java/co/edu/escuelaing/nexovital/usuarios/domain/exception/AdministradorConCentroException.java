package co.edu.escuelaing.nexovital.usuarios.domain.exception;

import java.util.UUID;

/**
 * El administrador ya tiene un centro registrado: un administrador de centro
 * de ayuda administra a lo sumo uno.
 *
 * <p>Hereda de {@link RuntimeException} y no de
 * {@link IllegalArgumentException}, igual que
 * {@link OrganizacionDuplicadaException}: así su {@code catch} no queda oculto
 * detrás del de datos inválidos.
 */
public class AdministradorConCentroException extends RuntimeException {

    public AdministradorConCentroException(UUID adminId) {
        super("El administrador ya tiene un centro registrado: " + adminId);
    }
}
