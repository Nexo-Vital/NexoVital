package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ResolutorSesion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;

/**
 * Resolución con el IdP externo (ADR-0008): el token identifica, la base
 * autoriza.
 *
 * <p>El {@code sub} del token de Firebase resuelve a la fila de {@code usuarios}
 * por {@code firebase_uid}, y el rol se lee de esa fila. Nunca del token: el
 * dominio ya usa {@code Usuario} como principal y varios casos de uso resuelven
 * pertenencia desde la base.
 *
 * <p>Un usuario sin {@code firebase_uid} enlazado no se autentica. Es la señal
 * de que la migración de esa cuenta está pendiente, no un error de token.
 */
public class ResolutorSesionFirebase implements ResolutorSesion {

    private final ValidadorTokenFirebase validador;
    private final UsuarioRepository usuarioRepository;

    public ResolutorSesionFirebase(ValidadorTokenFirebase validador, UsuarioRepository usuarioRepository) {
        this.validador = validador;
        this.usuarioRepository = usuarioRepository;
    }

    @Override
    public Usuario resolver(String token) {
        String uid = validador.validar(token);
        return usuarioRepository.buscarPorFirebaseUid(uid)
                .orElseThrow(() -> new UsuarioNoEncontradoException(
                        "Ningún usuario enlazado al uid " + uid));
    }
}
