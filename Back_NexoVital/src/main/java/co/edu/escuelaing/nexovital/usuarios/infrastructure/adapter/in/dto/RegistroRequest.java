package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto;

/**
 * Cuerpo de {@code POST /api/v1/registros}. Solo trae lo que el usuario elige:
 * el rol y, si es conductor, la placa y el modelo del vehículo. El nombre y el
 * correo los pone el token de Google.
 *
 * @param rol    {@code CIUDADANO}, {@code ADMIN_CENTRO_AYUDA} o {@code CONDUCTOR}
 * @param placa  placa del vehículo (solo conductor), por ejemplo {@code ABC123}
 * @param modelo modelo del vehículo (solo conductor)
 */
public record RegistroRequest(String rol, String placa, String modelo) {
}
