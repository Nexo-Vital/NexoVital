package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;

import java.util.Objects;

/**
 * Evento de aplicación que se publica al acreditar una donación. Lo consume el
 * listener post-commit que entrega el payload al
 * {@link co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort}: así el
 * push nunca ocurre dentro de la transacción (regla de oro del contrato: publish
 * POST-COMMIT).
 *
 * <p>Lleva el {@link ItemInventarioDto} ya proyectado y no el agregado de
 * dominio: es la misma forma pública que el módulo sirve por REST, así que no se
 * escribe un proyector nuevo ni se expone un tipo de dominio por el canal. Es el
 * espejo de {@code OrganizacionRegistradaEvento} en {@code usuarios}.
 */
public record DonacionRegistradaEvento(ItemInventarioDto item) {

    public DonacionRegistradaEvento {
        Objects.requireNonNull(item, "item es obligatorio");
    }
}
