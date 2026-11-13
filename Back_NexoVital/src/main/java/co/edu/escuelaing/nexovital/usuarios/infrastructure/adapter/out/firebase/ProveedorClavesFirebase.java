package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import java.security.Key;

/**
 * Fuente de claves públicas para verificar tokens de Firebase.
 *
 * <p>Es una interfaz y no una clase con HTTP adentro por una razón concreta:
 * así el validador se puede probar con un par de claves generado en el test,
 * sin red y sin proyecto de Firebase. La implementación real baja el JWKS
 * público de Google.
 */
@FunctionalInterface
public interface ProveedorClavesFirebase {

    /**
     * Devuelve la clave pública del {@code kid} indicado.
     *
     * @return la clave, o {@code null} si no se conoce ese identificador
     */
    Key clavePara(String kid);
}
