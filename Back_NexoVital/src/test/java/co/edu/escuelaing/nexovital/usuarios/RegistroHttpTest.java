package co.edu.escuelaing.nexovital.usuarios;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.infrastructure.config.RegistroAccesoDenegado;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoRegistradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ResolutorSesion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.VerificadorIdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.UsuarioJpaRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sprint 2, EP-06.F2.US1 (T10/T12): registro con Google y rechazo de quien no
 * tiene sesión válida, por HTTP y con la base real de la suite (H2).
 *
 * <p>Google no se llama: un verificador de prueba acepta tokens con la forma
 * {@code google|<uid>|<correo>} y rechaza cualquier otro, igual que el real
 * rechaza un token vencido, alterado o de otra aplicación. Esos cuatro casos de
 * token los prueba {@code ValidadorTokenFirebaseTest} contra la firma real.
 *
 * <p>Cada prueba usa correos {@code @registro.test} y se limpia al final, para
 * no cambiar los conteos de usuarios que verifican otras pruebas.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, RegistroHttpTest.IdpDePrueba.class})
class RegistroHttpTest {

    private static final String DOMINIO = "@registro.test";

    @TestConfiguration
    static class IdpDePrueba {
        @Bean
        VerificadorIdentidadExterna verificadorDePrueba() {
            return token -> {
                String[] partes = token.split("\\|");
                if (partes.length != 3 || !"google".equals(partes[0])) {
                    throw new CredencialesInvalidasException("firma inválida");
                }
                return new IdentidadExterna(partes[1], partes[2], true, "Persona " + partes[1]);
            };
        }
    }

    /**
     * El filtro de seguridad también ve el token de Google. Como ninguna de esas
     * cuentas tiene usuario todavía, se comporta como el resolutor real: token
     * de Google sin cuenta = no registrado; cualquier otro = inválido.
     */
    @MockitoBean
    private ResolutorSesion resolutorSesion;

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private UsuarioJpaRepository usuarioJpaRepository;
    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    private final Logger logger = (Logger) LoggerFactory.getLogger(RegistroAccesoDenegado.class);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    @BeforeEach
    void preparar() {
        when(resolutorSesion.resolver(anyString())).thenAnswer(invocacion -> {
            String token = invocacion.getArgument(0);
            if (token.startsWith("google|")) {
                throw new UsuarioNoRegistradoException(token.split("\\|")[1]);
            }
            throw new CredencialesInvalidasException("firma inválida");
        });
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void limpiar() {
        logger.detachAppender(appender);
        String patron = "%" + DOMINIO;
        String conductores = "SELECT id FROM usuarios.usuarios WHERE email LIKE ?";
        jdbcTemplate.update("DELETE FROM flota.placas WHERE ambulancia_id IN "
                + "(SELECT id FROM flota.ambulancias WHERE conductor_id IN (" + conductores + "))", patron);
        jdbcTemplate.update("DELETE FROM flota.ambulancias WHERE conductor_id IN (" + conductores + ")", patron);
        jdbcTemplate.update("DELETE FROM usuarios.usuarios WHERE email LIKE ?", patron);
    }

    // -----------------------------------------------------------------------
    // S-1: sin token válido no hay registro, y el intento queda registrado
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Sin token: 401 NO_AUTENTICADO y queda registrado como token_ausente")
    void sinTokenResponde401() throws Exception {
        mockMvc.perform(post("/api/v1/registros")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rol\":\"CIUDADANO\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));

        assertTrue(hayEvento("autenticacion_fallida", "ruta=/api/v1/registros", "motivo=token_ausente"));
    }

    @Test
    @DisplayName("Token alterado, vencido o de otra aplicación: 401 y queda registrado como token_invalido")
    void tokenInvalidoResponde401() throws Exception {
        registrar("token-alterado", "{\"rol\":\"CIUDADANO\"}")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));

        assertTrue(hayEvento("autenticacion_fallida", "ruta=/api/v1/registros", "motivo=token_invalido"));
    }

    @Test
    @DisplayName("Cuenta de Google sin registro en GET /sesiones/actual: 401 USUARIO_NO_REGISTRADO")
    void cuentaSinRegistroRecibeCodigoPropio() throws Exception {
        mockMvc.perform(get("/api/v1/sesiones/actual")
                        .header("Authorization", "Bearer " + tokenGoogle("uid-sin-registro")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("USUARIO_NO_REGISTRADO"));

        assertTrue(hayEvento("autenticacion_fallida", "ruta=/api/v1/sesiones/actual",
                "motivo=usuario_no_registrado"));
    }

    @Test
    @DisplayName("Token inválido en GET /sesiones/actual: 401 NO_AUTENTICADO, nunca USUARIO_NO_REGISTRADO")
    void tokenInvalidoNoSeConfundeConCuentaSinRegistro() throws Exception {
        mockMvc.perform(get("/api/v1/sesiones/actual").header("Authorization", "Bearer token-alterado"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.codigo").value("NO_AUTENTICADO"));
    }

    // -----------------------------------------------------------------------
    // S-1 (autorización): roles que no se pueden elegir
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Pedir ADMIN_PLATAFORMA: 403 ROL_NO_ELEGIBLE, se registra con el uid y no se crea el usuario")
    void rolDeAdministradorDePlataformaSeRechaza() throws Exception {
        String correo = correo("escalada");

        registrar(tokenGoogle("uid-escalada", correo), "{\"rol\":\"ADMIN_PLATAFORMA\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ROL_NO_ELEGIBLE"));

        assertTrue(hayEvento("acceso_denegado", "actor=google:uid-escalada", "motivo=rol_no_elegible"));
        assertFalse(usuarioJpaRepository.existsByEmail(correo), "un rechazo no debe crear el usuario");
    }

    @Test
    @DisplayName("Pedir ADMIN_ACOPIO: 403 ROL_NO_ELEGIBLE")
    void rolDeAdministradorDeAcopioSeRechaza() throws Exception {
        registrar(tokenGoogle("uid-acopio", correo("acopio")), "{\"rol\":\"ADMIN_ACOPIO\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.codigo").value("ROL_NO_ELEGIBLE"));
    }

    @Test
    @DisplayName("Rol que no existe o ausente: 400 DATOS_INVALIDOS")
    void rolInexistente() throws Exception {
        registrar(tokenGoogle("uid-raro", correo("raro")), "{\"rol\":\"SUPERUSUARIO\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
        registrar(tokenGoogle("uid-raro", correo("raro")), "{}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
    }

    // -----------------------------------------------------------------------
    // Registro exitoso y duplicados
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Ciudadano: 201 con nombre y correo del token, enlazado al uid de Google")
    void registraCiudadano() throws Exception {
        String correo = correo("ciudadano");

        registrar(tokenGoogle("uid-ciudadano", correo), "{\"rol\":\"CIUDADANO\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rol").value("CIUDADANO"))
                .andExpect(jsonPath("$.email").value(correo))
                .andExpect(jsonPath("$.nombre").value("Persona uid-ciudadano"));

        assertEquals("uid-ciudadano", usuarioJpaRepository.findByEmail(correo).orElseThrow().getFirebaseUid());
    }

    @Test
    @DisplayName("Administrador de centro: 201 con rol ADMIN_CENTRO_AYUDA")
    void registraAdministradorDeCentro() throws Exception {
        registrar(tokenGoogle("uid-centro", correo("centro")), "{\"rol\":\"ADMIN_CENTRO_AYUDA\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rol").value("ADMIN_CENTRO_AYUDA"));
    }

    @Test
    @DisplayName("La misma cuenta dos veces: 409 USUARIO_YA_REGISTRADO")
    void noRegistraDosVeces() throws Exception {
        String token = tokenGoogle("uid-doble", correo("doble"));
        registrar(token, "{\"rol\":\"CIUDADANO\"}").andExpect(status().isCreated());

        registrar(token, "{\"rol\":\"CONDUCTOR\",\"placa\":\"QWE321\",\"modelo\":\"Renault\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("USUARIO_YA_REGISTRADO"));
    }

    // -----------------------------------------------------------------------
    // Conductor: placa y modelo
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Conductor: 201 y su ambulancia queda con la placa normalizada, el modelo y desconectada")
    void registraConductorConSuAmbulancia() throws Exception {
        String correo = correo("conductor");

        String cuerpo = registrar(tokenGoogle("uid-conductor", correo),
                        "{\"rol\":\"CONDUCTOR\",\"placa\":\"rtx-101\",\"modelo\":\"Renault Master\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rol").value("CONDUCTOR"))
                .andReturn().getResponse().getContentAsString();

        UUID conductorId = UUID.fromString(cuerpo.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1"));
        AmbulanciaJpaEntity unidad = ambulanciaJpaRepository.findFirstByConductorId(conductorId).orElseThrow();
        assertEquals("RTX101", unidad.getPlaca());
        assertEquals("Renault Master", unidad.getModelo());
        assertFalse(unidad.isConectada(), "la unidad nace desconectada hasta que el conductor abre su consola");
    }

    @Test
    @DisplayName("Conductor sin placa o con placa mal formada: 400 y no se crea el usuario")
    void conductorSinPlacaValida() throws Exception {
        String correo = correo("sin-placa");

        registrar(tokenGoogle("uid-sin-placa", correo), "{\"rol\":\"CONDUCTOR\",\"modelo\":\"Renault\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.codigo").value("DATOS_INVALIDOS"));
        registrar(tokenGoogle("uid-sin-placa", correo),
                        "{\"rol\":\"CONDUCTOR\",\"placa\":\"12\",\"modelo\":\"Renault\"}")
                .andExpect(status().isBadRequest());

        assertFalse(usuarioJpaRepository.existsByEmail(correo));
    }

    @Test
    @DisplayName("Placa de una ambulancia que ya existe: 409 PLACA_DUPLICADA y se deshace el usuario")
    void placaRepetidaDeshaceElRegistro() throws Exception {
        String correo = correo("placa-repetida");

        registrar(tokenGoogle("uid-repetida", correo),
                        "{\"rol\":\"CONDUCTOR\",\"placa\":\"ABC101\",\"modelo\":\"Renault\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("PLACA_DUPLICADA"));

        assertFalse(usuarioJpaRepository.existsByEmail(correo),
                "la placa repetida deshace todo el registro: la persona puede intentar de nuevo");
    }

    /**
     * Concurrencia: dos conductores registran la MISMA placa nueva al mismo
     * tiempo. Los dos pasan la verificación previa (ninguna ambulancia la tiene
     * todavía); la clave primaria de {@code flota.placas} deja pasar solo a uno.
     */
    @Test
    @DisplayName("Dos registros simultáneos con la misma placa: uno 201, otro 409, una sola ambulancia")
    void placaSimultaneaSoloGanaUno() throws Exception {
        String placa = "RCC" + (100 + (int) (Math.random() * 900));
        String cuerpo = "{\"rol\":\"CONDUCTOR\",\"placa\":\"" + placa + "\",\"modelo\":\"Renault\"}";
        List<String> tokens = List.of(
                tokenGoogle("uid-carrera-a", correo("carrera-a")),
                tokenGoogle("uid-carrera-b", correo("carrera-b")));

        CountDownLatch salida = new CountDownLatch(1);
        ExecutorService hilos = Executors.newFixedThreadPool(2);
        List<Future<Integer>> resultados = new ArrayList<>();
        for (String token : tokens) {
            Callable<Integer> intento = () -> {
                salida.await();
                return registrar(token, cuerpo).andReturn().getResponse().getStatus();
            };
            resultados.add(hilos.submit(intento));
        }
        salida.countDown();
        List<Integer> estados = new ArrayList<>();
        for (Future<Integer> resultado : resultados) {
            estados.add(resultado.get());
        }
        hilos.shutdown();

        estados.sort(Integer::compareTo);
        assertEquals(List.of(201, 409), estados, "exactamente un registro gana la placa");
        Integer conEsaPlaca = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM flota.ambulancias WHERE placa = ?", Integer.class, placa);
        assertEquals(1, conEsaPlaca, "una placa, una ambulancia");
        long usuariosCreados = usuarioJpaRepository.findAll().stream()
                .filter(usuario -> usuario.getEmail().startsWith("carrera-"))
                .count();
        assertEquals(1, usuariosCreados, "el perdedor no queda creado a medias");
    }

    // -----------------------------------------------------------------------

    private ResultActions registrar(String token, String cuerpo) throws Exception {
        return mockMvc.perform(post("/api/v1/registros")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(cuerpo));
    }

    private static String tokenGoogle(String uid) {
        return tokenGoogle(uid, uid + DOMINIO);
    }

    private static String tokenGoogle(String uid, String correo) {
        return "google|" + uid + "|" + correo;
    }

    private static String correo(String nombre) {
        return nombre + DOMINIO;
    }

    private boolean hayEvento(String... fragmentos) {
        return appender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .anyMatch(mensaje -> Arrays.stream(fragmentos).allMatch(mensaje::contains));
    }
}
