package co.edu.escuelaing.nexovital.observabilidad;

import co.edu.escuelaing.nexovital.observabilidad.infrastructure.TraceId;
import co.edu.escuelaing.nexovital.observabilidad.infrastructure.TraceIdFilter;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Reglas de correlación de logs (ESC-7): la cabecera válida se reutiliza, la
 * inválida se reemplaza, siempre se devuelve en la respuesta y el MDC nunca se
 * queda pegado al hilo.
 */
class TraceIdFilterTest {

    private final TraceIdFilter filtro = new TraceIdFilter();

    private MockHttpServletRequest peticion() {
        return new MockHttpServletRequest("GET", "/api/v1/emergencias");
    }

    @Test
    @DisplayName("Reutiliza un X-Request-Id valido y lo devuelve en la respuesta")
    void reutilizaCabeceraValida() throws Exception {
        MockHttpServletRequest peticion = peticion();
        peticion.addHeader(TraceId.CABECERA, "abc-123-def");
        MockHttpServletResponse respuesta = new MockHttpServletResponse();

        String[] vistoDentro = new String[1];
        FilterChain cadena = (req, res) -> vistoDentro[0] = TraceId.actual();

        filtro.doFilter(peticion, respuesta, cadena);

        assertEquals("abc-123-def", vistoDentro[0], "dentro de la peticion el MDC trae el id del cliente");
        assertEquals("abc-123-def", respuesta.getHeader(TraceId.CABECERA));
    }

    @Test
    @DisplayName("Sin cabecera genera un id nuevo, lo publica y lo devuelve")
    void sinCabeceraGeneraUno() throws Exception {
        MockHttpServletResponse respuesta = new MockHttpServletResponse();

        String[] vistoDentro = new String[1];
        FilterChain cadena = (req, res) -> vistoDentro[0] = TraceId.actual();

        filtro.doFilter(peticion(), respuesta, cadena);

        assertNotNull(vistoDentro[0]);
        assertTrue(vistoDentro[0].matches("[0-9a-f-]{36}"), "el id generado es un UUID");
        assertEquals(vistoDentro[0], respuesta.getHeader(TraceId.CABECERA));
    }

    @Test
    @DisplayName("Una cabecera con salto de linea se descarta: no se inyectan lineas en el log")
    void cabeceraConSaltoDeLineaSeDescarta() throws Exception {
        MockHttpServletRequest peticion = peticion();
        peticion.addHeader(TraceId.CABECERA, "abc12345\nINFO linea falsa");

        MockHttpServletResponse respuesta = new MockHttpServletResponse();
        String[] vistoDentro = new String[1];
        FilterChain cadena = (req, res) -> vistoDentro[0] = TraceId.actual();

        filtro.doFilter(peticion, respuesta, cadena);

        assertNotEquals("abc12345\nINFO linea falsa", vistoDentro[0]);
        assertTrue(vistoDentro[0].matches("[0-9a-f-]{36}"), "se reemplaza por un UUID");
    }

    @Test
    @DisplayName("Una cabecera demasiado larga se descarta")
    void cabeceraDemasiadoLargaSeDescarta() throws Exception {
        String larga = "a".repeat(65);
        MockHttpServletRequest peticion = peticion();
        peticion.addHeader(TraceId.CABECERA, larga);

        String[] vistoDentro = new String[1];
        FilterChain cadena = (req, res) -> vistoDentro[0] = TraceId.actual();

        filtro.doFilter(peticion, new MockHttpServletResponse(), cadena);

        assertNotEquals(larga, vistoDentro[0]);
    }

    @Test
    @DisplayName("El MDC queda limpio aunque la cadena lance una excepcion")
    void limpiaElMdcAunqueFalleLaCadena() {
        MockHttpServletRequest peticion = peticion();
        FilterChain cadena = (req, res) -> {
            throw new IllegalStateException("fallo simulado");
        };

        assertThrows(IllegalStateException.class,
                () -> filtro.doFilter(peticion, new MockHttpServletResponse(), cadena));

        assertNull(TraceId.actual(), "el hilo del contenedor no hereda el id de esta peticion");
    }

    @Test
    @DisplayName("Un id aceptable nunca se confunde con uno generado")
    void aceptadoConservaElValorYRechazaLoDemas() {
        assertEquals("0123456789abcdef", TraceId.aceptado("0123456789abcdef"));
        assertEquals(36, TraceId.aceptado("").length());
        assertEquals(36, TraceId.aceptado(null).length());
        assertEquals(36, TraceId.aceptado("corto").length());
        assertEquals(36, TraceId.aceptado("con espacio").length());
        assertNotEquals(TraceId.nuevo(), TraceId.nuevo());
        assertEquals(36, UUID.fromString(TraceId.nuevo()).toString().length());
    }
}
