package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import co.edu.escuelaing.nexovital.usuarios.domain.model.DatosRegistro;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;

/**
 * Registro de una cuenta nueva que llega autenticada por Google (EP-06.F2.US1,
 * T10). Crea el usuario con el rol elegido y, si es conductor, su vehículo.
 */
public interface RegistrarUsuarioUseCase {

    Usuario registrar(IdentidadExterna identidad, DatosRegistro datos);
}
