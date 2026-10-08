# syntax=docker/dockerfile:1
# ==========================================================================
# Imagen del backend de NexoVital (Spring Boot, Java 21).
#
# Dos etapas:
#   1. build   : JDK completo + Maven Wrapper. Compila y empaqueta el JAR.
#   2. runtime : solo el JRE y el JAR. Es la imagen que se despliega; no lleva
#                codigo fuente, ni Maven, ni el JDK.
#
# Los tests NO se ejecutan aqui (-DskipTests): corren en local con
# `mvnw test` y, desde la Fase 2, en GitHub Actions antes de construir la imagen.
# ==========================================================================

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
# El wrapper puede llegar desde Windows con finales de linea CRLF o sin permiso
# de ejecucion: se normaliza aqui para que el build no dependa de eso.
RUN sed -i 's/\r$//' mvnw && chmod +x mvnw

COPY src/ src/
# La cache de ~/.m2 se conserva entre builds: Maven y las dependencias solo se
# descargan la primera vez.
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -DskipTests package \
    && cp target/nexovital-*.jar /workspace/app.jar


FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

# La aplicacion no corre como root.
RUN groupadd --system nexovital && useradd --system --gid nexovital --no-create-home nexovital
COPY --from=build /workspace/app.jar /app/app.jar
USER nexovital

# Perfil `docker`: PostgreSQL + usuarios demo + simulador de flota.
ENV SPRING_PROFILES_ACTIVE=docker
# La JVM usa como maximo el 75 % de la memoria asignada al contenedor.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0"

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
