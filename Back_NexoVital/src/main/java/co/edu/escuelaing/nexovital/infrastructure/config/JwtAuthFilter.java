package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ResolutorSesion;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Resuelve la sesión a partir del Bearer token y publica la autoridad
 * {@code ROLE_<ROL>} en el contexto de seguridad. Sin token válido no
 * autentica: la petición sigue su curso y Spring Security responde 401.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final String PREFIJO_BEARER = "Bearer ";

    /**
     * Atributo de la peticion que marca "token valido sin cuenta registrada".
     * Lo lee el entry point de {@link SecurityConfig}.
     */
    public static final String ATRIBUTO_USUARIO_NO_REGISTRADO = "nexovital.usuarioNoRegistrado";

    private final ResolutorSesion resolutorSesion;

    public JwtAuthFilter(ResolutorSesion resolutorSesion) {
        this.resolutorSesion = resolutorSesion;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(PREFIJO_BEARER)) {
            String token = header.substring(PREFIJO_BEARER.length());
            try {
                var usuario = resolutorSesion.resolver(token);
                var authentication = new UsernamePasswordAuthenticationToken(
                        usuario,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + usuario.getRol().name())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (UsuarioNoRegistradoException e) {
                // Token valido de Google, pero la cuenta aun no eligio su rol
                // (T10). Sigue sin autenticar —sale 401 como cualquier token que
                // no sirve— y se marca para que el entry point responda el
                // codigo USUARIO_NO_REGISTRADO y el front muestre el registro.
                request.setAttribute(ATRIBUTO_USUARIO_NO_REGISTRADO, Boolean.TRUE);
                SecurityContextHolder.clearContext();
            } catch (CredencialesInvalidasException | UsuarioNoEncontradoException e) {
                // Token inválido, o válido pero de un usuario que ya no existe: se
                // sigue sin autenticar y Spring Security responde 401.
                //
                // A propósito NO se atrapa cualquier excepción: un fallo de
                // infraestructura (la base caída, un bug) debe propagarse y salir
                // como 500, no disfrazarse de 401. Un 401 falso esconde la falla y
                // le miente a quien está debuggeando.
                SecurityContextHolder.clearContext();
            }
        }
        filterChain.doFilter(request, response);
    }
}
