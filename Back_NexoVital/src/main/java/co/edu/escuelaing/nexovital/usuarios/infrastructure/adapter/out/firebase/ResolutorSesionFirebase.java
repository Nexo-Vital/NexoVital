package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ResolutorSesion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Optional;

/**
 * Resolución con el IdP externo (ADR-0008): el token identifica, la base
 * autoriza.
 *
 * <p>El {@code sub} del token de Firebase resuelve a la fila de {@code usuarios}
 * por {@code firebase_uid}, y el rol se lee de esa fila. Nunca del token: el
 * dominio ya usa {@code Usuario} como principal y varios casos de uso resuelven
 * pertenencia desde la base.
 *
 * <p><b>Enlace por correo verificado (T10).</b> Si el uid no tiene usuario, pero
 * Google confirma el correo y existe un usuario con ese correo que aún no tiene
 * cuenta enlazada (el administrador de plataforma precargado), se enlaza en ese
 * momento. Sin correo verificado no se enlaza nada: un correo sin confirmar no
 * prueba que la cuenta sea de esa persona.
 *
 * <p>Si no hay usuario ni forma de enlazarlo, se lanza
 * {@link UsuarioNoRegistradoException}: la petición sale con 401
 * {@code USUARIO_NO_REGISTRADO} y el front lleva a la pantalla de registro.
 */
public class ResolutorSesionFirebase implements ResolutorSesion {

    private static final Logger LOG = LoggerFactory.getLogger(ResolutorSesionFirebase.class);

    private final ValidadorTokenFirebase validador;
    private final UsuarioRepository usuarioRepository;

    public ResolutorSesionFirebase(ValidadorTokenFirebase validador, UsuarioRepository usuarioRepository) {
        this.validador = validador;
        this.usuarioRepository = usuarioRepository;
    }

    @Override
    public Usuario resolver(String token) {
        IdentidadExterna identidad = validador.validarIdentidad(token);
        return usuarioRepository.buscarPorFirebaseUid(identidad.uid())
                .or(() -> enlazarPorCorreoVerificado(identidad))
                .orElseThrow(() -> new UsuarioNoRegistradoException(identidad.uid()));
    }

    private Optional<Usuario> enlazarPorCorreoVerificado(IdentidadExterna identidad) {
        if (!identidad.emailVerificado() || identidad.email() == null || identidad.email().isBlank()) {
            return Optional.empty();
        }
        Optional<Usuario> pendiente = usuarioRepository.buscarPorEmailSinEnlazar(identidad.email().trim());
        pendiente.ifPresent(usuario -> {
            usuarioRepository.enlazarFirebaseUid(usuario.getId(), identidad.uid());
            LOG.info("cuenta_enlazada usuario={} rol={}", usuario.getId(), usuario.getRol());
        });
        return pendiente;
    }
}
