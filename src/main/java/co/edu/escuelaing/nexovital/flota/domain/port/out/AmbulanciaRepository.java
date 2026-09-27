package co.edu.escuelaing.nexovital.flota.domain.port.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Outbound port for the fleet aggregate. The domain never sees JPA. */
public interface AmbulanciaRepository {

    List<Ambulancia> listarDisponiblesEnZona(String zona);

    Optional<Ambulancia> buscarPorId(UUID id);

    Ambulancia guardar(Ambulancia ambulancia);

    void actualizarEstado(UUID id, EstadoAmbulancia estado);
}
