package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto;

import java.util.Objects;

/**
 * Evento de aplicación que se publica cuando un administrador declara un insumo
 * nuevo en su centro. Lo consume {@link InventarioPushListener} después del
 * commit y lo entrega en {@code /topic/suministros}, el mismo canal de las
 * donaciones y los despachos: un suscriptor hace UPSERT por {@code id}, así que
 * un insumo que no conocía simplemente aparece. Espejo de
 * {@link DonacionRegistradaEvento}.
 */
public record ItemInventarioRegistradoEvento(ItemInventarioDto item) {

    public ItemInventarioRegistradoEvento {
        Objects.requireNonNull(item, "item es obligatorio");
    }
}
