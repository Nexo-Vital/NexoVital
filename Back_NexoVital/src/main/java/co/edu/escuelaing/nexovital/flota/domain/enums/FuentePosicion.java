package co.edu.escuelaing.nexovital.flota.domain.enums;

/**
 * Origin of a reported fleet position.
 *
 * <p>It is a data attribute of the report, not a state: the driver's device
 * sends {@code DEVICE} and the demo simulator sends {@code SIMULADA}. The wire
 * projection maps it to the front's lowercase {@code 'device' | 'simulated'}
 * literal.
 */
public enum FuentePosicion {
    DEVICE,
    SIMULADA
}
