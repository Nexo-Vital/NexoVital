package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.OrganizacionDuplicadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.CrearOrganizacionUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.OrganizacionRepository;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionDto;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Registra una organización: valida los campos obligatorios, rechaza el nombre
 * duplicado, persiste con el {@code id} que asigna el servidor y publica un
 * evento que el listener post-commit entrega al {@code PushPort}.
 *
 * <p>La transacción envuelve solo la persistencia. El push va DESPUÉS del commit
 * (regla de oro del contrato): el evento se consume con
 * {@code @TransactionalEventListener(AFTER_COMMIT)} en
 * {@link OrganizacionPushListener}. Es el mismo idioma que
 * {@code ReportarEmergenciaUseCaseImpl} en {@code mapa}.
 *
 * <p>{@code @Transactional} sí es necesario aquí: sin ella, el evento se
 * publicaría sin transacción activa y un {@code @TransactionalEventListener}
 * (que por defecto solo se dispara dentro de una transacción que confirma)
 * nunca lo consumiría. Con ella, el {@code AFTER_COMMIT} es real y garantiza
 * que el centro está durable antes de anunciarse.
 */
@Service
public class CrearOrganizacionUseCaseImpl implements CrearOrganizacionUseCase {

    private final OrganizacionRepository organizacionRepository;
    private final ApplicationEventPublisher eventPublisher;

    public CrearOrganizacionUseCaseImpl(OrganizacionRepository organizacionRepository,
                                        ApplicationEventPublisher eventPublisher) {
        this.organizacionRepository = organizacionRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public Organizacion crear(String nombre, TipoOrganizacion tipo, Ubicacion ubicacion, String zonaId) {
        if (nombre == null || nombre.isBlank()) {
            throw new IllegalArgumentException("El nombre es obligatorio.");
        }
        if (tipo == null) {
            throw new IllegalArgumentException("El tipo de organización es obligatorio.");
        }
        if (ubicacion == null) {
            throw new IllegalArgumentException("La ubicación es obligatoria.");
        }
        if (organizacionRepository.existePorNombre(nombre)) {
            throw new OrganizacionDuplicadaException(nombre);
        }

        Organizacion organizacion = new Organizacion(UUID.randomUUID(), nombre, tipo, zonaId, ubicacion);
        Organizacion guardada = organizacionRepository.guardar(organizacion);
        eventPublisher.publishEvent(new OrganizacionRegistradaEvento(OrganizacionDto.fromDomain(guardada)));
        return guardada;
    }
}
