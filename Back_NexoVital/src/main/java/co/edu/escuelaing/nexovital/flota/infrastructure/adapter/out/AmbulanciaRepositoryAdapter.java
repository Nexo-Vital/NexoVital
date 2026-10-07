package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence adapter for the fleet. It translates between the {@link Ambulancia}
 * aggregate and the JPA entity; the domain never sees JPA. It satisfies both the
 * write port and the read port.
 */
@Component
public class AmbulanciaRepositoryAdapter implements AmbulanciaRepository, FlotaQueryPort {

    /** States in which a unit is attending a request and cannot be disconnected. */
    private static final List<EstadoAmbulancia> ESTADOS_EN_SERVICIO =
            List.of(EstadoAmbulancia.EN_MISION, EstadoAmbulancia.EN_RUTA);

    private final AmbulanciaJpaRepository jpaRepository;

    public AmbulanciaRepositoryAdapter(AmbulanciaJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public List<Ambulancia> listarCandidatasParaSolicitud() {
        return jpaRepository.findByEstadoAndConectadaTrueAndSinSenalFalse(EstadoAmbulancia.DISPONIBLE).stream()
                .map(AmbulanciaRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public Optional<Ambulancia> buscarPorId(UUID id) {
        return jpaRepository.findById(id).map(AmbulanciaRepositoryAdapter::toDomain);
    }

    @Override
    public Ambulancia guardar(Ambulancia ambulancia) {
        AmbulanciaJpaEntity entity = new AmbulanciaJpaEntity(
                ambulancia.getId(), ambulancia.getPlaca(), ambulancia.getEstado(),
                ambulancia.getLat(), ambulancia.getLng(), ambulancia.getZona(),
                ambulancia.getConductorId());
        return toDomain(jpaRepository.save(entity));
    }

    @Override
    public int transicionAtomicaEstado(UUID id, EstadoAmbulancia estadoEsperado, EstadoAmbulancia nuevoEstado) {
        return jpaRepository.transicionAtomicaEstado(id, estadoEsperado, nuevoEstado);
    }

    @Override
    public int actualizarPosicionAtomica(UUID id, double lat, double lng, FuentePosicion fuente, Instant ahora) {
        return jpaRepository.actualizarPosicionAtomica(id, lat, lng, fuente, ahora);
    }

    @Override
    public int actualizarPosicionSimuladaAtomica(UUID id, double lat, double lng, Instant ahora) {
        // The simulator writes SIMULADA and steps aside for a unit owned by a DEVICE.
        return jpaRepository.actualizarPosicionSiNoLaTiene(
                id, lat, lng, FuentePosicion.SIMULADA, ahora, FuentePosicion.DEVICE);
    }

    @Override
    public List<Ambulancia> listarConSenalVencida(Instant limite) {
        return jpaRepository.findBySinSenalFalseAndUltimaPosicionEnBefore(limite).stream()
                .map(AmbulanciaRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public int marcarSinSenalAtomica(UUID id, Instant limite) {
        return jpaRepository.marcarSinSenalAtomica(id, limite);
    }

    @Override
    public int conectarAtomica(UUID id) {
        return jpaRepository.conectarAtomica(id);
    }

    @Override
    public int desconectarAtomica(UUID id) {
        return jpaRepository.desconectarAtomica(id, ESTADOS_EN_SERVICIO);
    }

    @Override
    public int ocuparAtomica(UUID id) {
        return jpaRepository.transicionAtomicaEstadoSiConectada(
                id, EstadoAmbulancia.DISPONIBLE, EstadoAmbulancia.EN_MISION);
    }

    @Override
    public List<Ambulancia> consultarFlota() {
        return jpaRepository.findAll().stream().map(AmbulanciaRepositoryAdapter::toDomain).toList();
    }

    @Override
    public Optional<Ambulancia> buscarPorConductor(UUID conductorId) {
        return jpaRepository.findFirstByConductorId(conductorId).map(AmbulanciaRepositoryAdapter::toDomain);
    }

    private static Ambulancia toDomain(AmbulanciaJpaEntity entity) {
        return new Ambulancia(
                entity.getId(), entity.getPlaca(), entity.getEstado(),
                entity.getLat(), entity.getLng(), entity.getZona(),
                entity.getConductorId(), entity.getVersion(),
                entity.getUltimaPosicionEn(), entity.getFuentePosicion(), entity.isSinSenal(),
                entity.isConectada());
    }
}
