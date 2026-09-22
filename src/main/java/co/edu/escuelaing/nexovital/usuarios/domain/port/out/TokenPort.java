package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import java.util.UUID;

/**
 * Puerto de salida de emisión y validación de tokens. El dominio no conoce JJWT.
 */
public interface TokenPort {

    String generar(UUID usuarioId);

    boolean validar(String token);

    UUID extraerSubject(String token);
}
