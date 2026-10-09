package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ConsultarNombreUsuarioUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/** Lee el nombre visible de un usuario por su id. */
@Service
public class ConsultarNombreUsuarioUseCaseImpl implements ConsultarNombreUsuarioUseCase {

    private final UsuarioRepository usuarioRepository;

    public ConsultarNombreUsuarioUseCaseImpl(UsuarioRepository usuarioRepository) {
        this.usuarioRepository = usuarioRepository;
    }

    @Override
    public Optional<String> nombreDe(UUID usuarioId) {
        if (usuarioId == null) {
            return Optional.empty();
        }
        return usuarioRepository.buscarPorId(usuarioId)
                .map(Usuario::getNombre)
                .filter(nombre -> !nombre.isBlank());
    }
}
