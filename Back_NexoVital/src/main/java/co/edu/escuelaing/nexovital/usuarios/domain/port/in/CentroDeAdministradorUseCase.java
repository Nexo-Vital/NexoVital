package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

import java.util.Optional;
import java.util.UUID;

/**
 * Puerto de entrada: el centro que administra un usuario con rol de
 * administrador de centro de ayuda. Cada administrador tiene a lo sumo uno.
 */
public interface CentroDeAdministradorUseCase {

    /**
     * @param adminId id del usuario administrador
     * @return el centro que administra, o vacío si todavía no creó uno
     */
    Optional<Organizacion> buscar(UUID adminId);

    /**
     * Registra el centro del administrador. Queda como centro de acopio, sin
     * zona, y se anuncia en el mapa después del commit, igual que cualquier
     * organización nueva.
     *
     * @param adminId   id del usuario administrador; obligatorio
     * @param nombre    nombre único del centro; obligatorio
     * @param ubicacion coordenada del centro; obligatoria
     * @return el centro persistido
     * @throws IllegalArgumentException si falta un dato o el nombre es demasiado largo
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.AdministradorConCentroException
     *                                  si el administrador ya tiene un centro
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.OrganizacionDuplicadaException
     *                                  si ya existe una organización con ese nombre
     */
    Organizacion registrar(UUID adminId, String nombre, Ubicacion ubicacion);
}
