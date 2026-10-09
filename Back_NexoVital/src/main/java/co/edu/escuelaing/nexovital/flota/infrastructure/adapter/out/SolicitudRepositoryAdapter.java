package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Persistence adapter for the request aggregate. */
@Component
public class SolicitudRepositoryAdapter implements SolicitudRepository {

    private final SolicitudJpaRepository jpaRepository;
    private final RechazoSolicitudJpaRepository rechazoJpaRepository;

    public SolicitudRepositoryAdapter(SolicitudJpaRepository jpaRepository,
                                      RechazoSolicitudJpaRepository rechazoJpaRepository) {
        this.jpaRepository = jpaRepository;
        this.rechazoJpaRepository = rechazoJpaRepository;
    }

    @Override
    public SolicitudAmbulancia guardar(SolicitudAmbulancia solicitud) {
        SolicitudJpaEntity entity = new SolicitudJpaEntity(
                solicitud.getId(),
                solicitud.getLat(),
                solicitud.getLng(),
                solicitud.getEmergenciaId(),
                solicitud.getEstado(),
                solicitud.getCentroAyudaId(),
                solicitud.getZonaId(),
                solicitud.getSolicitadaEn(),
                solicitud.getTimeoutEn(),
                solicitud.getSolicitanteId(),
                solicitud.getAmbulanciasNotificadas(),
                solicitud.getAmbulanciaAsignadaId(),
                solicitud.getLlegadaEn());
        return toDomain(jpaRepository.save(entity));
    }

    @Override
    public Optional<SolicitudAmbulancia> buscarPorId(UUID id) {
        return jpaRepository.findById(id).map(this::toDomain);
    }

    @Override
    @Transactional
    public int transicionAtomicaAsignar(UUID idSolicitud, UUID ambulanciaId,
                                        EstadoSolicitud estadoEsperado, EstadoSolicitud nuevoEstado) {
        return jpaRepository.transicionAtomicaAsignar(idSolicitud, ambulanciaId, estadoEsperado, nuevoEstado);
    }

    @Override
    @Transactional
    public int transicionAtomicaEstado(UUID idSolicitud,
                                       EstadoSolicitud estadoEsperado, EstadoSolicitud nuevoEstado) {
        return jpaRepository.transicionAtomicaEstado(idSolicitud, estadoEsperado, nuevoEstado);
    }

    @Override
    @Transactional
    public int transicionAtomicaLlegada(UUID idSolicitud, Instant llegadaEn) {
        return jpaRepository.transicionAtomicaLlegada(idSolicitud, llegadaEn);
    }

    @Override
    @Transactional
    public int transicionAtomicaFinalizar(UUID idSolicitud, Collection<EstadoSolicitud> estadosEsperados,
                                          EstadoSolicitud nuevoEstado) {
        return jpaRepository.transicionAtomicaFinalizar(idSolicitud, estadosEsperados, nuevoEstado);
    }

    @Override
    public List<SolicitudAmbulancia> listarPendientesVencidas(Instant ahora) {
        return toDomainLista(jpaRepository
                .findTop200ByEstadoAndTimeoutEnBeforeOrderByTimeoutEnAsc(EstadoSolicitud.PENDIENTE, ahora));
    }

    @Override
    public List<SolicitudAmbulancia> listarPorAmbulanciaAsignada(UUID ambulanciaId) {
        return toDomainLista(jpaRepository.findByAmbulanciaAsignadaIdOrderBySolicitadaEnDesc(ambulanciaId));
    }

    @Override
    public List<SolicitudAmbulancia> listarDelSolicitante(UUID solicitanteId, Collection<EstadoSolicitud> estados) {
        return toDomainLista(jpaRepository.findBySolicitanteIdAndEstadoInOrderBySolicitadaEnDesc(solicitanteId, estados));
    }

    @Override
    @Transactional
    public int transicionAtomicaExpirar(UUID idSolicitud, EstadoSolicitud estadoEsperado,
                                        EstadoSolicitud nuevoEstado, Instant ahora) {
        return jpaRepository.transicionAtomicaExpirar(idSolicitud, estadoEsperado, nuevoEstado, ahora);
    }

    @Override
    public List<SolicitudAmbulancia> listarPendientesNotificadasA(UUID ambulanciaId, Instant ahora) {
        return toDomainLista(jpaRepository
                .buscarPendientesNotificadasA(ambulanciaId, EstadoSolicitud.PENDIENTE, ahora));
    }

    @Override
    public List<SolicitudAmbulancia> listarPendientesNoNotificadasA(UUID ambulanciaId, Instant ahora) {
        return toDomainLista(jpaRepository
                .buscarPendientesNoNotificadasA(ambulanciaId, EstadoSolicitud.PENDIENTE, ahora));
    }

    /**
     * The entity is loaded, the unit is appended to its notified collection and
     * the change is flushed at once. Changing the collection bumps the row
     * {@code @Version} with the usual {@code WHERE version = ?} check, and every
     * state transition of a request bumps that version too: if the request moved
     * after it was read here, the flush fails with an optimistic-lock exception
     * and nothing is written. Only the collection is touched; the state and the
     * deadline are never rewritten.
     */
    @Override
    @Transactional
    public Optional<SolicitudAmbulancia> incorporarNotificadaSiSigueAbierta(UUID idSolicitud,
                                                                           UUID ambulanciaId,
                                                                           Instant ahora) {
        Optional<SolicitudJpaEntity> encontrada = jpaRepository.findById(idSolicitud);
        if (encontrada.isEmpty()) {
            return Optional.empty();
        }
        SolicitudJpaEntity entity = encontrada.get();
        boolean abierta = entity.getEstado() == EstadoSolicitud.PENDIENTE
                && entity.getTimeoutEn().isAfter(ahora);
        if (!abierta || entity.getAmbulanciasNotificadas().contains(ambulanciaId)) {
            return Optional.empty();
        }
        entity.getAmbulanciasNotificadas().add(ambulanciaId);
        return Optional.of(toDomain(jpaRepository.saveAndFlush(entity)));
    }

    /**
     * The decline lives in its own table and has its own key, so writing it
     * never touches the request row: no state, no deadline and no version
     * change, and nothing an accept could collide with.
     */
    @Override
    @Transactional
    public boolean registrarRechazo(UUID idSolicitud, UUID ambulanciaId, Instant rechazadaEn) {
        RechazoSolicitudId id = new RechazoSolicitudId(idSolicitud, ambulanciaId);
        if (rechazoJpaRepository.existsById(id)) {
            return false;
        }
        rechazoJpaRepository.saveAndFlush(new RechazoSolicitudJpaEntity(idSolicitud, ambulanciaId, rechazadaEn));
        return true;
    }

    private SolicitudAmbulancia toDomain(SolicitudJpaEntity entity) {
        return armar(entity, rechazosPorSolicitud(List.of(entity.getId()))
                .getOrDefault(entity.getId(), List.of()));
    }

    /** Maps a whole list reading its declines with ONE extra query. */
    private List<SolicitudAmbulancia> toDomainLista(List<SolicitudJpaEntity> entities) {
        if (entities.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<UUID>> rechazos = rechazosPorSolicitud(
                entities.stream().map(SolicitudJpaEntity::getId).toList());
        return entities.stream()
                .map(entity -> armar(entity, rechazos.getOrDefault(entity.getId(), List.of())))
                .toList();
    }

    /** Units that declined each request, oldest decline first. */
    private Map<UUID, List<UUID>> rechazosPorSolicitud(Collection<UUID> solicitudIds) {
        Map<UUID, List<UUID>> rechazos = new HashMap<>();
        for (RechazoSolicitudJpaEntity rechazo : rechazoJpaRepository.buscarPorSolicitudes(solicitudIds)) {
            rechazos.computeIfAbsent(rechazo.getSolicitudId(), id -> new ArrayList<>())
                    .add(rechazo.getAmbulanciaId());
        }
        return rechazos;
    }

    private static SolicitudAmbulancia armar(SolicitudJpaEntity entity, List<UUID> ambulanciasRechazaron) {
        return SolicitudAmbulancia.restaurar(
                entity.getId(),
                entity.getLat(),
                entity.getLng(),
                entity.getEmergenciaId(),
                entity.getEstado(),
                entity.getCentroAyudaId(),
                entity.getZonaId(),
                entity.getSolicitadaEn(),
                entity.getTimeoutEn(),
                entity.getSolicitanteId(),
                entity.getAmbulanciasNotificadas(),
                ambulanciasRechazaron,
                entity.getAmbulanciaAsignadaId(),
                entity.getLlegadaEn(),
                entity.getVersion());
    }
}
