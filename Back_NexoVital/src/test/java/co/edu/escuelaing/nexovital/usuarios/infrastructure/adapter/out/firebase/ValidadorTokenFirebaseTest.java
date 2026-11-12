package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * El validador es la puerta de entrada del sistema: si acepta un token que no
 * corresponde, la autorización por rol deja de significar algo. Se prueba sin
 * red y sin proyecto de Firebase: se genera un par RSA en el test y se publica
 * como si fuera el JWKS de Google.
 *
 * <p>Casos cubiertos: el camino feliz, token expirado, audiencia de otro
 * proyecto, emisor de otro proyecto, {@code kid} desconocido y firma con una
 * clave ajena.
 */
class ValidadorTokenFirebaseTest {

    private static final String PROJECT_ID = "nexovital-test";
    private static final String ISSUER = "https://securetoken.google.com/" + PROJECT_ID;
    private static final String KID = "clave-de-prueba";

    private static KeyPair parValido;
    private static KeyPair parAjeno;

    @BeforeAll
    static void generarClaves() throws Exception {
        KeyPairGenerator generador = KeyPairGenerator.getInstance("RSA");
        generador.initialize(2048);
        parValido = generador.generateKeyPair();
        parAjeno = generador.generateKeyPair();
    }

    private ValidadorTokenFirebase validador() {
        Map<String, java.security.PublicKey> claves = Map.of(KID, parValido.getPublic());
        return new ValidadorTokenFirebase(kid -> claves.get(kid), PROJECT_ID);
    }

    private String token(PrivateKey clave, String audiencia, String emisor, Instant expira) {
        return Jwts.builder()
                .subject("uid-del-usuario")
                .issuer(emisor)
                .audience().add(audiencia).and()
                .expiration(Date.from(expira))
                .header().keyId(KID).and()
                .signWith(clave, Jwts.SIG.RS256)
                .compact();
    }

    @Test
    void aceptaUnTokenValidoYDevuelveElUid() {
        String token = token(parValido.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));

        assertEquals("uid-del-usuario", validador().validar(token));
    }

    @Test
    void rechazaUnTokenExpirado() {
        String token = token(parValido.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().minus(5, ChronoUnit.MINUTES));

        assertThrows(CredencialesInvalidasException.class, () -> validador().validar(token));
    }

    @Test
    void rechazaUnTokenDeOtroProyectoPorAudiencia() {
        String token = token(parValido.getPrivate(), "otro-proyecto", ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));

        assertThrows(CredencialesInvalidasException.class, () -> validador().validar(token));
    }

    @Test
    void rechazaUnTokenDeOtroEmisor() {
        String token = token(parValido.getPrivate(), PROJECT_ID, "https://securetoken.google.com/otro",
                Instant.now().plus(1, ChronoUnit.HOURS));

        assertThrows(CredencialesInvalidasException.class, () -> validador().validar(token));
    }

    @Test
    void rechazaUnaFirmaDeOtraClave() {
        String token = token(parAjeno.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));

        assertThrows(CredencialesInvalidasException.class, () -> validador().validar(token));
    }

    @Test
    void rechazaUnKidDesconocido() {
        String token = token(parValido.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));
        ValidadorTokenFirebase sinClaves = new ValidadorTokenFirebase(kid -> null, PROJECT_ID);

        assertThrows(CredencialesInvalidasException.class, () -> sinClaves.validar(token));
    }

    @Test
    void rechazaUnTokenAlterado() {
        String token = token(parValido.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));
        String alterado = token.substring(0, token.length() - 2) + "xx";

        assertThrows(CredencialesInvalidasException.class, () -> validador().validar(alterado));
    }
    // -----------------------------------------------------------------------
    // Sprint 2, T10/T12: identidad completa y tiempo de validación (S-1)
    // -----------------------------------------------------------------------

    @Test
    void devuelveCorreoVerificadoYnombreDeLaCuentaDeGoogle() {
        String token = Jwts.builder()
                .subject("uid-del-usuario")
                .issuer(ISSUER)
                .audience().add(PROJECT_ID).and()
                .expiration(Date.from(Instant.now().plus(1, ChronoUnit.HOURS)))
                .claim("email", "persona@gmail.com")
                .claim("email_verified", true)
                .claim("name", "Persona Prueba")
                .header().keyId(KID).and()
                .signWith(parValido.getPrivate(), Jwts.SIG.RS256)
                .compact();

        co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna identidad =
                validador().validarIdentidad(token);

        assertEquals("uid-del-usuario", identidad.uid());
        assertEquals("persona@gmail.com", identidad.email());
        assertEquals(true, identidad.emailVerificado());
        assertEquals("Persona Prueba", identidad.nombre());
    }

    @Test
    void sinClaimDeVerificacionElCorreoNoCuentaComoVerificado() {
        String token = token(parValido.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));

        assertEquals(false, validador().validarIdentidad(token).emailVerificado());
    }

    /**
     * Escenario S-1: "la validación agrega menos de 50 ms por solicitud". Se mide
     * el percentil 95 de 300 validaciones (firma RS256, emisor, audiencia y
     * expiración) después de calentar la JVM. Las claves públicas de Google ya
     * están en memoria (el proveedor de JWKS las cachea), así que esto es lo que
     * paga cada petición.
     */
    @Test
    void validarUnTokenTardaMenosDe50msEnElPercentil95() {
        ValidadorTokenFirebase validador = validador();
        String token = token(parValido.getPrivate(), PROJECT_ID, ISSUER,
                Instant.now().plus(1, ChronoUnit.HOURS));
        for (int i = 0; i < 100; i++) {
            validador.validar(token);
        }

        long[] duraciones = new long[300];
        for (int i = 0; i < duraciones.length; i++) {
            long inicio = System.nanoTime();
            validador.validar(token);
            duraciones[i] = System.nanoTime() - inicio;
        }
        java.util.Arrays.sort(duraciones);
        double p95Ms = duraciones[(int) Math.ceil(duraciones.length * 0.95) - 1] / 1_000_000.0;

        org.junit.jupiter.api.Assertions.assertTrue(p95Ms < 50.0,
                "el p95 de la validación debe ser menor a 50 ms; fue " + p95Ms + " ms");
    }
}
