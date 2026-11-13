package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.limites.infrastructure.adapter.in.LimiteSolicitudesInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registro de interceptores HTTP.
 *
 * <p>Las rutas se declaran acá y no dentro del interceptor para que el límite se
 * vea de un vistazo: si mañana hay un endpoint nuevo que también conviene
 * proteger, se agrega en esta lista y no hay que leer la lógica.
 */
@Configuration
public class ConfiguracionWebMvc implements WebMvcConfigurer {

    private final LimiteSolicitudesInterceptor limiteSolicitudesInterceptor;

    public ConfiguracionWebMvc(LimiteSolicitudesInterceptor limiteSolicitudesInterceptor) {
        this.limiteSolicitudesInterceptor = limiteSolicitudesInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(limiteSolicitudesInterceptor)
                .addPathPatterns(
                        "/api/v1/emergencias",
                        "/api/v1/centros-acopio/*/inventario/donacion");
    }
}
