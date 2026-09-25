package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.exception.EmergenciaNoEncontradaException;
import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ActualizarEmergenciaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.EmergenciaRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Actualiza el estado y/o el nivel de una emergencia existente: valida que haya
 * algo que actualizar, busca el agregado, lo reemplaza por una instancia nueva
 * (el dominio es inmutable, decisión D4) y publica un evento que el listener
 * post-commit entrega al {@code PushPort}.
 *
 * <p>La transacción envuelve solo la persistencia. El push va DESPUÉS del
 * commit (regla de oro del contrato): el evento se consume con
 * {@code @TransactionalEventListener(AFTER_COMMIT)} en
 * {@link EmergenciaPushListener}.
 */
@Service
public class ActualizarEmergenciaUseCaseImpl implements ActualizarEmergenciaUseCase {

    private final EmergenciaRepository emergenciaRepository;
    private final ApplicationEventPublisher eventPublisher;

    public ActualizarEmergenciaUseCaseImpl(EmergenciaRepository emergenciaRepository,
                                           ApplicationEventPublisher eventPublisher) {
        this.emergenciaRepository = emergenciaRepository;
        this.eventPublisher = eventPublisher;
    }

    @Override
    @Transactional
    public Emergencia actualizar(UUID id, EstadoEmergencia estado, NivelEmergencia nivel) {
        // D2: sin estado ni nivel no hay nada que actualizar. Se decide antes de
        // tocar la base para no emitir un 200 sin efecto.
        if (estado == null && nivel == null) {
            throw new IllegalArgumentException("Debe indicar el estado o el nivel a actualizar.");
        }

        Emergencia actual = emergenciaRepository.buscarPorId(id)
                .orElseThrow(() -> new EmergenciaNoEncontradaException(id));

        // Un campo nulo conserva el valor vigente; se resuelven los dos ANTES de
        // construir, para que un PATCH con ambos campos nazca UNA sola instancia
        // (no una intermedia por campo).
        EstadoEmergencia estadoEfectivo = (estado != null) ? estado : actual.getEstado();
        NivelEmergencia nivelEfectivo = (nivel != null) ? nivel : actual.getNivel();

        Emergencia guardada = emergenciaRepository.guardar(actual.con(estadoEfectivo, nivelEfectivo));
        eventPublisher.publishEvent(new EmergenciaActualizadaEvento(guardada));
        return guardada;
    }
}
