package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtParser;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Valida un ID token de Firebase y devuelve el identificador del usuario en el
 * IdP (el {@code sub}).
 *
 * <p>Comprueba lo que hay que comprobar y nada más: firma RS256 contra el JWKS
 * público, emisor, audiencia y expiración. No decide roles —eso es de la base,
 * según el ADR-0008— y no guarda credenciales: la verificación usa solo claves
 * públicas.
 *
 * <p>El bean solo existe si hay {@code nexovital.auth.firebase.project-id}.
 * Así el arranque local y la suite no dependen de tener Firebase configurado.
 */
@Component
@ConditionalOnProperty(name = "nexovital.auth.firebase.project-id")
public class ValidadorTokenFirebase {

    private final String projectId;
    private final JwtParser parser;

    public ValidadorTokenFirebase(
            ProveedorClavesFirebase proveedor,
            @Value("${nexovital.auth.firebase.project-id}") String projectId) {
        this.projectId = projectId;
        this.parser = Jwts.parser()
                // El `kid` del header elige la clave: Google rota el JWKS y el
                // token viejo sigue validando con la clave que le corresponde.
                .keyLocator(header -> header.get("kid") instanceof String kid
                        ? proveedor.clavePara(kid)
                        : null)
                .requireIssuer("https://securetoken.google.com/" + projectId)
                .requireAudience(projectId)
                .build();
    }

    /**
     * @return el {@code sub} del token, que es el UID del usuario en Firebase
     * @throws CredencialesInvalidasException si el token no verifica
     */
    public String validar(String idToken) {
        try {
            Claims claims = parser.parseSignedClaims(idToken).getPayload();
            String uid = claims.getSubject();
            if (uid == null || uid.isBlank()) {
                throw new CredencialesInvalidasException("El token no trae subject");
            }
            return uid;
        } catch (JwtException | IllegalArgumentException e) {
            throw new CredencialesInvalidasException("Token de Firebase inválido: " + e.getMessage());
        }
    }

    /** Audiencia esperada: el proyecto de Firebase configurado. */
    public String projectId() {
        return projectId;
    }
}
