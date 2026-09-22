package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import co.edu.escuelaing.nexovital.usuarios.domain.model.CredencialesLogin;
import co.edu.escuelaing.nexovital.usuarios.domain.model.SesionAuth;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;

public interface AuthenticationUseCase {

    /**
     * Autentica unas credenciales aplicando la máquina de estados del bloqueo
     * por intentos fallidos (diseño D5).
     *
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.CuentaBloqueadaException
     *         si la cuenta está bloqueada o si este intento dispara el bloqueo
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException
     *         si la contraseña es incorrecta
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException
     *         si no existe una cuenta con ese email
     */
    SesionAuth login(CredencialesLogin credenciales);

    /**
     * Resuelve el usuario de una sesión a partir del token (diseño D9: el
     * bloqueo no revoca tokens ya emitidos).
     *
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException
     *         si el token no es válido o expiró
     */
    Usuario validarToken(String token);
}
