package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.port.out.NombreUsuarioPort;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ConsultarNombreUsuarioUseCase;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Nombres desde el módulo usuarios, guardados en memoria porque no cambian. */
@Component
public class NombreUsuarioAdapter implements NombreUsuarioPort {

    private final ConsultarNombreUsuarioUseCase consultarNombreUsuarioUseCase;
    private final Map<UUID, String> nombres = new ConcurrentHashMap<>();

    public NombreUsuarioAdapter(ConsultarNombreUsuarioUseCase consultarNombreUsuarioUseCase) {
        this.consultarNombreUsuarioUseCase = consultarNombreUsuarioUseCase;
    }

    @Override
    public String nombreDe(UUID usuarioId) {
        if (usuarioId == null) {
            return null;
        }
        String conocido = nombres.get(usuarioId);
        if (conocido != null) {
            return conocido;
        }
        String nombre = consultarNombreUsuarioUseCase.nombreDe(usuarioId).orElse(null);
        if (nombre != null) {
            nombres.put(usuarioId, nombre);
        }
        return nombre;
    }
}
