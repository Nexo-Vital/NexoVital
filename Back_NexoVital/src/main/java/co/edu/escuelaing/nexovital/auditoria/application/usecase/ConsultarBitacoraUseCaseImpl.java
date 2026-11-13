package co.edu.escuelaing.nexovital.auditoria.application.usecase;

import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.in.ConsultarBitacoraUseCase;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Consulta de la bitácora de peticiones. La única regla es acotar el límite:
 * sin filtro, la consulta devuelve las más recientes y nunca la tabla entera.
 */
@Service
public class ConsultarBitacoraUseCaseImpl implements ConsultarBitacoraUseCase {

    private final BitacoraPeticionesPort bitacora;

    public ConsultarBitacoraUseCaseImpl(BitacoraPeticionesPort bitacora) {
        this.bitacora = bitacora;
    }

    @Override
    public List<PeticionRegistrada> buscar(FiltroBitacora filtro) {
        int limite = filtro.limite() <= 0
                ? LIMITE_POR_DEFECTO
                : Math.min(filtro.limite(), LIMITE_MAXIMO);
        return bitacora.buscar(new FiltroBitacora(
                filtro.traceId(), filtro.usuarioId(), filtro.recursoId(),
                filtro.desde(), filtro.hasta(), limite));
    }
}
