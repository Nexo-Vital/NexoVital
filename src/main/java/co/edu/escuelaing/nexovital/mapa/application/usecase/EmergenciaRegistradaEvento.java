package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;

import java.util.Objects;

/**
 * Evento de aplicación que se publica al persistir una emergencia. Lo consume el
 * listener post-commit que entrega el payload al
 * {@link co.edu.escuelaing.nexovital.mapa.domain.port.out.PushPort}: así el push
 * nunca ocurre dentro de la transacción (regla de oro del contrato: publish
 * POST-COMMIT).
 */
public record EmergenciaRegistradaEvento(Emergencia emergencia) {

    public EmergenciaRegistradaEvento {
        Objects.requireNonNull(emergencia, "emergencia es obligatoria");
    }
}
