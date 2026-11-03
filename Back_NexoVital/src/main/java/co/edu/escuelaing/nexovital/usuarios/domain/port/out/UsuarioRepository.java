package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;

import java.util.Optional;
import java.util.UUID;

public interface UsuarioRepository {

    Optional<Usuario> buscarPorEmail(String email);

    /**
     * Resuelve por el {@code sub} del token del IdP externo (ADR-0008). Es la
     * búsqueda del camino con Firebase: el token identifica, la base autoriza.
     */
    Optional<Usuario> buscarPorFirebaseUid(String firebaseUid);

    Optional<Usuario> buscarPorId(UUID id);

    boolean existePorEmail(String email);

    /**
     * Enlaza una cuenta con su usuario del IdP externo (ADR-0008). Es
     * idempotente: el seeder la llama en cada arranque con los UID conocidos.
     */
    void enlazarFirebaseUid(UUID id, String firebaseUid);

    Usuario guardar(Usuario usuario);
}
