package co.edu.escuelaing.nexovital.mapa.application.usecase;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.in.ListarEmergenciasUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.EmergenciaRepository;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Devuelve el registro de emergencias. Es una consulta de solo lectura: la
 * lógica vive en el adaptador de persistencia y aquí solo se delega, igual que
 * en {@link ConsultarMapaUseCaseImpl}.
 */
@Service
public class ListarEmergenciasUseCaseImpl implements ListarEmergenciasUseCase {

    private final EmergenciaRepository emergenciaRepository;

    public ListarEmergenciasUseCaseImpl(EmergenciaRepository emergenciaRepository) {
        this.emergenciaRepository = emergenciaRepository;
    }

    @Override
    public List<Emergencia> listar() {
        return emergenciaRepository.listar();
    }
}
