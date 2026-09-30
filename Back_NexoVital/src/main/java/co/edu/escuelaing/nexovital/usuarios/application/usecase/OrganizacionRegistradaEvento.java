package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionDto;

import java.util.Objects;

/**
 * Evento de aplicación que se publica al persistir una organización (centro). Lo
 * consume el listener post-commit que entrega el payload al
 * {@link co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort}: así el
 * push nunca ocurre dentro de la transacción (regla de oro del contrato: publish
 * POST-COMMIT).
 *
 * <p>Lleva el {@link OrganizacionDto} ya proyectado y no el agregado de dominio:
 * el listener solo publica, y la forma pública del DTO ya es la del elemento del
 * mapa (decisión D5: no se escribe un proyector nuevo). Reutilizar el DTO de
 * {@code usuarios} no acopla a {@code mapa}: es la proyección que este módulo ya
 * sirve por REST.
 */
public record OrganizacionRegistradaEvento(OrganizacionDto organizacion) {

    public OrganizacionRegistradaEvento {
        Objects.requireNonNull(organizacion, "organizacion es obligatoria");
    }
}
