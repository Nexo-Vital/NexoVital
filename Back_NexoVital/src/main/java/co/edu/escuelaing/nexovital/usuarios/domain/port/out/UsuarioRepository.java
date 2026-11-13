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

    /**
     * Guarda un usuario nuevo ya enlazado a su cuenta del IdP externo
     * (registro con Google, T10). Escribe de inmediato para que un correo o
     * un uid repetido falle aquí y no al confirmar la transacción.
     */
    Usuario guardarEnlazado(Usuario usuario, String firebaseUid);

    /**
     * Usuario con ese correo que todavía no tiene cuenta del IdP enlazada. Es
     * el caso del administrador de plataforma precargado: se enlaza la primera
     * vez que entra con Google, si Google confirma que el correo es suyo.
     */
    Optional<Usuario> buscarPorEmailSinEnlazar(String email);
}
