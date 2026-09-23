package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.model.Mapa;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ConsultarMapaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.CentroMapaQueryPort;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import org.springframework.stereotype.Service;

/**
 * Arma el read-model del mapa: las zonas propias del módulo y los centros
 * leídos por el puerto hacia {@code usuarios}. La lógica de consulta vive en
 * los adaptadores; aquí solo se orquesta.
 */
@Service
public class ConsultarMapaUseCaseImpl implements ConsultarMapaUseCase {

    private final ZonaRepository zonaRepository;
    private final CentroMapaQueryPort centroMapaQueryPort;

    public ConsultarMapaUseCaseImpl(ZonaRepository zonaRepository, CentroMapaQueryPort centroMapaQueryPort) {
        this.zonaRepository = zonaRepository;
        this.centroMapaQueryPort = centroMapaQueryPort;
    }

    @Override
    public Mapa consultar() {
        return new Mapa(zonaRepository.listar(), centroMapaQueryPort.listarCentros());
    }
}
