package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import java.util.Optional;
import java.util.UUID;

/** Puerto de entrada: nombre visible de un usuario para otros módulos (ADR-0003). */
public interface ConsultarNombreUsuarioUseCase {

    /** Nombre del usuario, o vacío si el id es null o no existe. */
    Optional<String> nombreDe(UUID usuarioId);
}
