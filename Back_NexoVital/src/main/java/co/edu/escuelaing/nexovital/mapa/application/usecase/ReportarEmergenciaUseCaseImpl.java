package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.Zona;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ReportarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.EmergenciaRepository;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * Registra una emergencia: valida los campos, resuelve su zona a partir del
 * punto con el punto-en-polígono ya implementado (decisión D4), la persiste y
 * publica un evento que el listener post-commit entrega al {@code PushPort}.
 *
 * <p>La transacción envuelve solo la persistencia. El push va DESPUÉS del commit
 * (regla de oro del contrato): el evento se consume con
 * {@code @TransactionalEventListener(AFTER_COMMIT)} en
 * {@link EmergenciaPushListener}.
 */
@Service
public class ReportarEmergenciaUseCaseImpl implements ReportarEmergenciaUseCase {

    private final EmergenciaRepository emergenciaRepository;
    private final ZonaRepository zonaRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;

    public ReportarEmergenciaUseCaseImpl(EmergenciaRepository emergenciaRepository,
                                         ZonaRepository zonaRepository,
                                         ApplicationEventPublisher eventPublisher,
                                         Clock clock) {
        this.emergenciaRepository = emergenciaRepository;
        this.zonaRepository = zonaRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    @Override
    @Transactional
    public Emergencia reportar(Ubicacion ubicacion, NivelEmergencia nivel, String descripcion) {
        if (ubicacion == null) {
            throw new IllegalArgumentException("La ubicación es obligatoria.");
        }
        if (nivel == null) {
            throw new IllegalArgumentException("El nivel de emergencia es obligatorio.");
        }
        if (descripcion == null || descripcion.isBlank()) {
            throw new IllegalArgumentException("La descripción es obligatoria.");
        }

        Emergencia emergencia = new Emergencia(
                UUID.randomUUID(),
                ubicacion,
                nivel,
                EstadoEmergencia.REGISTRADA,
                descripcion,
                resolverZona(ubicacion),
                Instant.now(clock));

        Emergencia guardada = emergenciaRepository.guardar(emergencia);
        eventPublisher.publishEvent(new EmergenciaRegistradaEvento(guardada));
        return guardada;
    }

    /**
     * Resuelve la zona del punto recorriendo el catálogo y aplicando
     * {@link Zona#contiene(Ubicacion)} (decisión D4). Devuelve el id de la
     * primera zona que contiene el punto, o {@code null} si no cae en ninguna:
     * el reporte se acepta igual.
     */
    private String resolverZona(Ubicacion punto) {
        return zonaRepository.listar().stream()
                .filter(zona -> zona.contiene(punto))
                .map(Zona::getId)
                .findFirst()
                .orElse(null);
    }
}
