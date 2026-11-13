package co.edu.escuelaing.nexovital.usuarios.domain.model;

/**
 * Lo que el usuario elige al registrarse: el rol y, si es conductor, los datos
 * del vehículo. La identidad (nombre y correo) no viaja aquí: la pone el token.
 *
 * @param rol    rol elegido
 * @param placa  placa del vehículo; solo para {@link RolUsuario#CONDUCTOR}
 * @param modelo modelo del vehículo; solo para {@link RolUsuario#CONDUCTOR}
 */
public record DatosRegistro(RolUsuario rol, String placa, String modelo) {
}
