package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.model.Mapa;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ConsultarMapaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.AlertasEscasezQueryPort;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.CentroMapaQueryPort;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.ZonaRepository;
import org.springframework.stereotype.Service;

/**
 * Arma el read-model del mapa: las zonas propias del módulo, los centros
 * leídos por el puerto hacia {@code usuarios} y las alertas de escasez activas
 * leídas por el puerto hacia {@code recursos}. La lógica de consulta vive en
 * los adaptadores; aquí solo se orquesta.
 */
@Service
public class ConsultarMapaUseCaseImpl implements ConsultarMapaUseCase {

    private final ZonaRepository zonaRepository;
    private final CentroMapaQueryPort centroMapaQueryPort;
    private final AlertasEscasezQueryPort alertasEscasezQueryPort;

    public ConsultarMapaUseCaseImpl(ZonaRepository zonaRepository,
                                    CentroMapaQueryPort centroMapaQueryPort,
                                    AlertasEscasezQueryPort alertasEscasezQueryPort) {
        this.zonaRepository = zonaRepository;
        this.centroMapaQueryPort = centroMapaQueryPort;
        this.alertasEscasezQueryPort = alertasEscasezQueryPort;
    }

    @Override
    public Mapa consultar() {
        return new Mapa(
                zonaRepository.listar(),
                centroMapaQueryPort.listarCentros(),
                alertasEscasezQueryPort.listarActivas());
    }
}
