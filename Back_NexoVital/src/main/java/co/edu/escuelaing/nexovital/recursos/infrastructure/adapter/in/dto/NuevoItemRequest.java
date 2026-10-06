package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.recursos.domain.model.NuevoItemInventario;

/**
 * Un insumo a declarar: {@code {nombre, disponible, requerido}}. Es el cuerpo de
 * {@code POST /api/v1/centros-acopio/mio/inventario} y cada elemento de
 * {@code items} al crear el centro. {@code disponible} es lo que el centro tiene
 * hoy y {@code requerido} el máximo que necesita.
 */
public record NuevoItemRequest(String nombre, Integer disponible, Integer requerido) {

    public NuevoItemInventario aDominio() {
        return new NuevoItemInventario(nombre, disponible, requerido);
    }
}
