package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.AdministradorConCentroException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.OrganizacionDuplicadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.CentroDeAdministradorUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.OrganizacionRepository;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionDto;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Centro de un administrador de centro de ayuda: lo consulta y lo registra.
 *
 * <p>El registro sigue el mismo idioma que {@link CrearOrganizacionUseCaseImpl}:
 * valida, rechaza el nombre duplicado, persiste y publica
 * {@link OrganizacionRegistradaEvento}, que {@link OrganizacionPushListener}
 * entrega al mapa DESPUÉS del commit. La diferencia es el dueño: el centro
 * guarda el {@code adminId} y un administrador no puede registrar un segundo.
 *
 * <p>La comprobación "ya tiene centro" es una lectura previa; la garantía bajo
 * concurrencia es la restricción única de {@code admin_id} en la tabla.
 */
@Service
public class CentroDeAdministradorUseCaseImpl implements CentroDeAdministradorUseCase {

    /** Longitud de la columna {@code nombre} de {@code organizaciones}. */
    static final int LONGITUD_MAXIMA_NOMBRE = 120;

    private final OrganizacionRepository organizacionRepository;
    private final ApplicationEventPublisher eventPublisher;

    public CentroDeAdministradorUseCaseImpl(OrganizacionRepository organizacionRepository,
                                            ApplicationEventPublisher eventPublisher) {
        this.organizacionRepository = organizacionRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Organizacion> buscar(UUID adminId) {
        if (adminId == null) {
            return Optional.empty();
        }
        return organizacionRepository.buscarPorAdmin(adminId);
    }

    @Override
    @Transactional
    public Organizacion registrar(UUID adminId, String nombre, Ubicacion ubicacion) {
        if (adminId == null) {
            throw new IllegalArgumentException("El administrador es obligatorio.");
        }
        if (nombre == null || nombre.isBlank()) {
            throw new IllegalArgumentException("El nombre del centro es obligatorio.");
        }
        String nombreLimpio = nombre.trim();
        if (nombreLimpio.length() > LONGITUD_MAXIMA_NOMBRE) {
            throw new IllegalArgumentException(
                    "El nombre del centro no puede superar " + LONGITUD_MAXIMA_NOMBRE + " caracteres.");
        }
        if (ubicacion == null) {
            throw new IllegalArgumentException("La ubicación del centro es obligatoria.");
        }
        if (organizacionRepository.buscarPorAdmin(adminId).isPresent()) {
            throw new AdministradorConCentroException(adminId);
        }
        if (organizacionRepository.existePorNombre(nombreLimpio)) {
            throw new OrganizacionDuplicadaException(nombreLimpio);
        }

        Organizacion centro = new Organizacion(
                UUID.randomUUID(), nombreLimpio, TipoOrganizacion.CENTRO_ACOPIO, null, ubicacion, adminId);
        Organizacion guardado = organizacionRepository.guardar(centro);
        eventPublisher.publishEvent(new OrganizacionRegistradaEvento(OrganizacionDto.fromDomain(guardado)));
        return guardado;
    }
}
