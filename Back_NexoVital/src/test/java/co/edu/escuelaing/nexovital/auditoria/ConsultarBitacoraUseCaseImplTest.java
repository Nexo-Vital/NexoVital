package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.application.usecase.ConsultarBitacoraUseCaseImpl;
import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** T15: la consulta acota el límite y no altera el resto del filtro. */
class ConsultarBitacoraUseCaseImplTest {

    @ParameterizedTest(name = "limite {0} -> {1}")
    @CsvSource({"0, 100", "-5, 100", "20, 20", "1000, 1000", "50000, 1000"})
    @DisplayName("El limite queda entre 1 y 1000, con 100 por defecto")
    void acotaElLimite(int pedido, int esperado) {
        AtomicReference<FiltroBitacora> recibido = new AtomicReference<>();
        BitacoraPeticionesPort port = new BitacoraPeticionesPort() {
            @Override
            public void registrar(PeticionRegistrada peticion) {
                // No se usa.
            }

            @Override
            public List<PeticionRegistrada> buscar(FiltroBitacora filtro) {
                recibido.set(filtro);
                return List.of();
            }
        };
        UUID usuario = UUID.randomUUID();

        new ConsultarBitacoraUseCaseImpl(port)
                .buscar(new FiltroBitacora("traza-1", usuario, null, null, null, pedido));

        assertEquals(esperado, recibido.get().limite());
        assertEquals("traza-1", recibido.get().traceId());
        assertEquals(usuario, recibido.get().usuarioId());
    }
}
