package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import java.math.BigInteger;
import java.security.Key;
import java.security.KeyFactory;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Baja el JWKS público de Google para los tokens de Firebase y lo cachea.
 *
 * <p>Firebase firma los ID tokens con RS256 y publica las claves en un JWKS
 * abierto. No hace falta service account: la verificación usa solo claves
 * públicas, así que el backend no guarda ninguna credencial.
 *
 * <p>El caché se refresca cuando aparece un {@code kid} desconocido (Google
 * rotó la clave) o cuando vence el TTL. Sin el refresco por {@code kid}, una
 * rotación dejaría a todo el mundo con 401 hasta reiniciar el proceso.
 */
@Component
public class ProveedorClavesGoogleJwks implements ProveedorClavesFirebase {

    private static final Logger LOG = LoggerFactory.getLogger(ProveedorClavesGoogleJwks.class);

    /** JWKS de los ID tokens de Firebase. */
    static final String URL_JWKS =
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

    private static final Duration VIGENCIA_CACHE = Duration.ofHours(1);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final String urlJwks;

    private final Map<String, Key> claves = new HashMap<>();
    private Instant expiraCache = Instant.EPOCH;

    public ProveedorClavesGoogleJwks(
            RestClient.Builder restClientBuilder,
            ObjectMapper objectMapper,
            @Value("${nexovital.auth.firebase.jwks-uri:" + URL_JWKS + "}") String urlJwks) {
        this.restClient = restClientBuilder.build();
        this.objectMapper = objectMapper;
        this.urlJwks = urlJwks;
    }

    @Override
    public synchronized Key clavePara(String kid) {
        if (kid == null) {
            return null;
        }
        if (Instant.now().isAfter(expiraCache) || !claves.containsKey(kid)) {
            refrescar();
        }
        return claves.get(kid);
    }

    private void refrescar() {
        try {
            String cuerpo = restClient.get().uri(urlJwks).retrieve().body(String.class);
            JsonNode raiz = objectMapper.readTree(cuerpo);
            Map<String, Key> nuevas = new HashMap<>();
            for (JsonNode jwk : raiz.path("keys")) {
                if (!"RSA".equals(jwk.path("kty").asText())) {
                    continue;
                }
                String kid = jwk.path("kid").asText();
                BigInteger modulo = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("n").asText()));
                BigInteger exponente = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("e").asText()));
                nuevas.put(kid, KeyFactory.getInstance("RSA")
                        .generatePublic(new RSAPublicKeySpec(modulo, exponente)));
            }
            claves.clear();
            claves.putAll(nuevas);
            expiraCache = Instant.now().plus(VIGENCIA_CACHE);
            LOG.info("JWKS de Firebase recargado: {} claves", claves.size());
        } catch (Exception e) {
            // Si el refresco falla se conservan las claves anteriores: un corte
            // momentáneo de red no debe tumbar la autenticación de todos.
            LOG.warn("No se pudo recargar el JWKS de Firebase; se conservan {} claves",
                    claves.size(), e);
        }
    }
}
