package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.port.out.TokenPort;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * Emisión y validación de JWT (HS256) con JJWT.
 *
 * <p>El secreto nunca tiene un valor fijo en el repositorio: un secreto
 * comiteado permite a cualquiera con acceso forjar tokens válidos.
 *
 * <p>Con el perfil {@code prod}, {@code NEXOVITAL_JWT_SECRET} es obligatorio: si
 * está vacío, el arranque falla con un mensaje accionable.
 *
 * <p>Fuera de {@code prod} (desarrollo local), si la variable no está definida
 * se genera un secreto ALEATORIO en memoria para esta ejecución. No se escribe
 * en disco ni en el log, y cambia en cada arranque, así que los tokens emitidos
 * dejan de valer al reiniciar (igual que la base H2 en memoria).
 *
 * <p>En cualquier perfil, un secreto definido que mida menos de 32 bytes aborta
 * el arranque: es un error de configuración, no una ausencia.
 */
@Component
public class JwtTokenAdapter implements TokenPort {

    /** Longitud mínima de clave que exige HS256. */
    private static final int BYTES_MINIMOS_HS256 = 32;

    private static final Logger LOG = LoggerFactory.getLogger(JwtTokenAdapter.class);

    private final SecretKey key;
    private final long expirationMillis;
    private final Clock clock;

    public JwtTokenAdapter(@Value("${nexovital.jwt.secret}") String secret,
                           @Value("${nexovital.jwt.expiration}") long expirationMillis,
                           Clock clock,
                           Environment environment) {
        this.key = construirClave(secret, environment.acceptsProfiles(Profiles.of("prod")));
        this.expirationMillis = expirationMillis;
        this.clock = clock;
    }

    @Override
    public String generar(UUID usuarioId) {
        Instant ahora = Instant.now(clock);
        return Jwts.builder()
                .subject(usuarioId.toString())
                .issuedAt(Date.from(ahora))
                .expiration(Date.from(ahora.plusMillis(expirationMillis)))
                // HS256 explícito: JJWT, si se le deja elegir, deduce el
                // algoritmo de la longitud del secreto (un secreto de 48 bytes
                // produce HS384). Fijarlo mantiene el encabezado `alg`
                // determinista y coherente con lo documentado (README.md), sin
                // que dependa de cuántos bytes tenga la clave del entorno.
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    @Override
    public boolean validar(String token) {
        try {
            parseClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    @Override
    public UUID extraerSubject(String token) {
        Claims claims = parseClaims(token);
        return UUID.fromString(claims.getSubject());
    }

    private Claims parseClaims(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    static SecretKey construirClave(String secret, boolean produccion) {
        if (secret == null || secret.isBlank()) {
            if (!produccion) {
                byte[] aleatorio = new byte[BYTES_MINIMOS_HS256];
                new SecureRandom().nextBytes(aleatorio);
                LOG.warn("NEXOVITAL_JWT_SECRET no está definido: se generó un secreto JWT aleatorio solo "
                        + "para esta ejecución (desarrollo). Los tokens dejan de valer al reiniciar. "
                        + "Con el perfil prod el secreto es obligatorio.");
                return Keys.hmacShaKeyFor(aleatorio);
            }
            throw new IllegalStateException(
                    "NEXOVITAL_JWT_SECRET no está definido. Exporte un secreto de al menos 32 bytes para HS256 "
                            + "antes de arrancar, por ejemplo: $env:NEXOVITAL_JWT_SECRET = (openssl rand -base64 32). "
                            + "No se usa un valor por defecto a propósito: un secreto comiteado permite forjar tokens.");
        }
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < BYTES_MINIMOS_HS256) {
            throw new IllegalStateException(
                    "NEXOVITAL_JWT_SECRET debe medir al menos " + BYTES_MINIMOS_HS256 + " bytes para HS256 "
                            + "(actual: " + bytes.length + " bytes). Genere uno con: openssl rand -base64 32");
        }
        return Keys.hmacShaKeyFor(bytes);
    }
}
