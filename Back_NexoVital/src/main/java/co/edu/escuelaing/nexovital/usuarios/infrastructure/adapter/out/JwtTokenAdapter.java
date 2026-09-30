package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.port.out.TokenPort;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * Emisión y validación de JWT (HS256) con JJWT.
 *
 * <p>El secreto es obligatorio y no tiene valor por defecto: un secreto
 * comiteado en el repositorio permite a cualquiera con acceso forjar tokens
 * válidos. Si {@code NEXOVITAL_JWT_SECRET} está vacío o mide menos de 32 bytes,
 * el arranque falla con un mensaje accionable en lugar de degradarse en
 * silencio.
 */
@Component
public class JwtTokenAdapter implements TokenPort {

    /** Longitud mínima de clave que exige HS256. */
    private static final int BYTES_MINIMOS_HS256 = 32;

    private final SecretKey key;
    private final long expirationMillis;
    private final Clock clock;

    public JwtTokenAdapter(@Value("${nexovital.jwt.secret}") String secret,
                           @Value("${nexovital.jwt.expiration}") long expirationMillis,
                           Clock clock) {
        this.key = construirClave(secret);
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

    private static SecretKey construirClave(String secret) {
        if (secret == null || secret.isBlank()) {
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
