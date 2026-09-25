package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;

import java.util.Objects;

/**
 * Evento de aplicación que se publica al actualizar una emergencia. Lo consume
 * el listener post-commit que entrega el payload al
 * {@link co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort}: así el
 * push nunca ocurre dentro de la transacción (regla de oro del contrato:
 * publish POST-COMMIT).
 *
 * <p>Es el espejo de {@link EmergenciaRegistradaEvento}: mismo payload (el
 * agregado de dominio) para que el front lo procese con el mismo UPSERT por
 * {@code id} que ya usa para una emergencia nueva (decisión D5/D6 del ODD).
 */
public record EmergenciaActualizadaEvento(Emergencia emergencia) {

    public EmergenciaActualizadaEvento {
        Objects.requireNonNull(emergencia, "emergencia es obligatoria");
    }
}
