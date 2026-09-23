package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.OrganizacionRepository;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Lista las organizaciones aplicando el filtro opcional por tipo. La lógica de
 * consulta vive en el adaptador de persistencia; aquí solo se orquesta.
 */
@Service
public class ListarOrganizacionesUseCaseImpl implements ListarOrganizacionesUseCase {

    private final OrganizacionRepository organizacionRepository;

    public ListarOrganizacionesUseCaseImpl(OrganizacionRepository organizacionRepository) {
        this.organizacionRepository = organizacionRepository;
    }

    @Override
    public List<Organizacion> listar(TipoOrganizacion tipo) {
        return organizacionRepository.listar(tipo);
    }
}
