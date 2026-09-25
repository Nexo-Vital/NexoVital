package co.edu.escuelaing.nexovital.usuarios.domain.exception;

/**
 * Ya existe una organización registrada con el nombre solicitado (AC2). El
 * controlador la traduce a {@code 400 ORGANIZACION_DUPLICADA}: el contrato solo
 * declara 400 para {@code POST /organizaciones}, así que un 409 se saldría de él
 * (decisión D3).
 *
 * <p>Hereda de {@link RuntimeException} y <b>no</b> de
 * {@link IllegalArgumentException}: si heredara de esta última, su {@code catch}
 * específico en el controlador nunca se alcanzaría (el de datos inválidos lo
 * atraparía antes por ser más general) y un nombre duplicado se reportaría con
 * el código equivocado {@code DATOS_INVALIDOS}.
 */
public class OrganizacionDuplicadaException extends RuntimeException {

    public OrganizacionDuplicadaException(String nombre) {
        super("Ya existe una organización registrada con el nombre: " + nombre);
    }
}
