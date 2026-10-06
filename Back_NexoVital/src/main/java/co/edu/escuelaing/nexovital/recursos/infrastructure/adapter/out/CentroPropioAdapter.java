package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.recursos.domain.exception.CentroYaRegistradoException;
import co.edu.escuelaing.nexovital.recursos.domain.exception.NombreCentroDuplicadoException;
import co.edu.escuelaing.nexovital.recursos.domain.model.CentroPropio;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.CentroPropioPort;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.AdministradorConCentroException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.OrganizacionDuplicadaException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.CentroDeAdministradorUseCase;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * Satisface {@link CentroPropioPort} delegando en el caso de uso público de
 * {@code usuarios}. Igual que {@link CentroAcopioQueryAdapter}, es un punto de
 * {@code recursos} que conoce al módulo dueño del centro, y lo hace solo por su
 * puerto de entrada (ADR-0003). Traduce los tipos y las excepciones de
 * {@code usuarios} a los de {@code recursos}, para que el resto del módulo no
 * dependa de ellos.
 */
@Component
public class CentroPropioAdapter implements CentroPropioPort {

    private final CentroDeAdministradorUseCase centroDeAdministradorUseCase;

    public CentroPropioAdapter(CentroDeAdministradorUseCase centroDeAdministradorUseCase) {
        this.centroDeAdministradorUseCase = centroDeAdministradorUseCase;
    }

    @Override
    public Optional<CentroPropio> buscarPorAdmin(UUID adminId) {
        return centroDeAdministradorUseCase.buscar(adminId).map(CentroPropioAdapter::aCentroPropio);
    }

    @Override
    public CentroPropio registrar(UUID adminId, String nombre, Double lat, Double lng) {
        if (lat == null || lng == null) {
            throw new IllegalArgumentException("La ubicación del centro es obligatoria.");
        }
        Ubicacion ubicacion;
        try {
            ubicacion = new Ubicacion(lat, lng);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("La ubicación del centro no es válida.");
        }
        try {
            return aCentroPropio(centroDeAdministradorUseCase.registrar(adminId, nombre, ubicacion));
        } catch (AdministradorConCentroException e) {
            throw new CentroYaRegistradoException();
        } catch (OrganizacionDuplicadaException e) {
            throw new NombreCentroDuplicadoException(nombre == null ? "" : nombre.trim());
        }
    }

    private static CentroPropio aCentroPropio(Organizacion organizacion) {
        return new CentroPropio(
                organizacion.getId(),
                organizacion.getNombre(),
                organizacion.getUbicacion().lat(),
                organizacion.getUbicacion().lng());
    }
}
