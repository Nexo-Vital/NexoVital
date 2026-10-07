package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence adapter for the request aggregate. */
@Component
public class SolicitudRepositoryAdapter implements SolicitudRepository {

    private final SolicitudJpaRepository jpaRepository;

    public SolicitudRepositoryAdapter(SolicitudJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
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
        return jpaRepository.findById(id).map(SolicitudRepositoryAdapter::toDomain);
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
        return jpaRepository
                .findTop200ByEstadoAndTimeoutEnBeforeOrderByTimeoutEnAsc(EstadoSolicitud.PENDIENTE, ahora)
                .stream()
                .map(SolicitudRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public List<SolicitudAmbulancia> listarPorAmbulanciaAsignada(UUID ambulanciaId) {
        return jpaRepository
                .findByAmbulanciaAsignadaIdOrderBySolicitadaEnDesc(ambulanciaId).stream()
                .map(SolicitudRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    @Transactional
    public int transicionAtomicaExpirar(UUID idSolicitud, EstadoSolicitud estadoEsperado,
                                        EstadoSolicitud nuevoEstado, Instant ahora) {
        return jpaRepository.transicionAtomicaExpirar(idSolicitud, estadoEsperado, nuevoEstado, ahora);
    }

    @Override
    public List<SolicitudAmbulancia> listarPendientesNotificadasA(UUID ambulanciaId, Instant ahora) {
        return jpaRepository
                .buscarPendientesNotificadasA(ambulanciaId, EstadoSolicitud.PENDIENTE, ahora).stream()
                .map(SolicitudRepositoryAdapter::toDomain)
                .toList();
    }

    private static SolicitudAmbulancia toDomain(SolicitudJpaEntity entity) {
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
                entity.getAmbulanciaAsignadaId(),
                entity.getLlegadaEn(),
                entity.getVersion());
    }
}
