package co.edu.escuelaing.nexovital.flota.domain.port.out;

import java.util.UUID;

/** Nombre visible de un conductor o solicitante; los usuarios son de otro módulo. */
public interface NombreUsuarioPort {

    /** Nombre del usuario, o null si no se conoce. */
    String nombreDe(UUID usuarioId);
}
