@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
title Nexo Vital - demo Sprint 2 (topologia completa)

echo ============================================================
echo   Nexo Vital - DEMO Sprint 2
echo   nginx + 2 backends + PostgreSQL + RabbitMQ + Prometheus + Grafana
echo ============================================================
echo.

REM ------------------------------------------------------------------
REM 0) Carpetas completas
REM ------------------------------------------------------------------
if not exist "%ROOT%\docker-compose.yml" goto :incomplete
if not exist "%ROOT%\Back_NexoVital\pom.xml" goto :incomplete
if not exist "%ROOT%\Front_NexoVital\package.json" goto :incomplete

REM ------------------------------------------------------------------
REM 1) .env local (ignorado por git). No se sobreescribe si ya existe.
REM ------------------------------------------------------------------
if exist "%ROOT%\.env" goto :env_ready
echo [..] creando .env local...
> "%ROOT%\.env" echo POSTGRES_PASSWORD=nexovital-local
>> "%ROOT%\.env" echo NEXOVITAL_JWT_SECRET=
>> "%ROOT%\.env" echo GRAFANA_PASSWORD=nexovital
echo [ok] .env creado (POSTGRES_PASSWORD=nexovital-local).
echo.
:env_ready

REM ------------------------------------------------------------------
REM 2) Motor de Docker
REM ------------------------------------------------------------------
docker info >nul 2>nul
if not errorlevel 1 goto :docker_ok

echo [..] Docker no esta corriendo. Iniciando Docker Desktop...
set "DOCKER_EXE=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
if not exist "%DOCKER_EXE%" set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_EXE%" goto :docker_missing

start "" "%DOCKER_EXE%"
echo [..] esperando al motor de Docker (hasta 4 minutos)...
powershell -NoProfile -Command "$end=(Get-Date).AddMinutes(4); while((Get-Date) -lt $end){ docker info *> $null; if ($LASTEXITCODE -eq 0) { exit 0 }; Start-Sleep -Seconds 3 }; exit 1"
if errorlevel 1 goto :docker_timeout
:docker_ok

echo [ok] motor de Docker listo.
echo.

REM ------------------------------------------------------------------
REM 3) Construir y levantar todo
REM ------------------------------------------------------------------
echo [..] docker compose up -d --build
echo      La PRIMERA vez compila el back, compila el front y descarga
echo      imagenes: puede tardar varios minutos. No cierres esta ventana.
echo.
pushd "%ROOT%"
docker compose up -d --build
if errorlevel 1 goto :compose_fail

REM ------------------------------------------------------------------
REM 4) Esperar a que la API responda por nginx
REM ------------------------------------------------------------------
echo.
echo [..] esperando a que http://localhost:8080/actuator/health responda...
powershell -NoProfile -Command "$end=(Get-Date).AddMinutes(8); while((Get-Date) -lt $end){ try { $r=Invoke-WebRequest -UseBasicParsing 'http://localhost:8080/actuator/health' -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 3 }; exit 1"
if errorlevel 1 goto :health_timeout
echo [ok] API arriba a traves de nginx.
echo.

echo [..] estado de los contenedores:
docker compose ps
echo.

REM ------------------------------------------------------------------
REM 5) Abrir las pestanas de la demo
REM ------------------------------------------------------------------
start "" http://localhost:8080
start "" http://localhost:9090/alerts
start "" http://localhost:3000

echo ============================================================
echo   QUE DEMOSTRAR
echo ============================================================
echo.
echo   1) APLICACION (nginx -^> 2 backends)
echo      http://localhost:8080
echo      Login: conductor1@nexovital.co / conductor123  (Firebase)
echo      En DevTools -^> Network, la respuesta trae la cabecera
echo      X-Upstream: backend-1 o backend-2 (balanceo real).
echo.
echo   2) DISPONIBILIDAD / FAILOVER (ESC-1)
echo      En otra terminal:
echo        cd "%ROOT%"
echo        docker compose ps -q backend-1
echo        docker kill ^<id-de-backend-1^>
echo      Esperado: la app sigue respondiendo, 0 errores 5xx y la
echo      alerta NexoVitalInstanciaCaida pasa a firing en /alerts.
echo      Volver a levantarlo:
echo        docker compose up -d backend-1
echo.
echo   3) OBSERVABILIDAD (ESC-8)
echo      Prometheus:  http://localhost:9090/alerts   (10 reglas)
echo      Grafana:     http://localhost:3000          (admin / nexovital)
echo        Tableros: "NexoVital - Metricas de negocio"
echo                  "NexoVital - Metricas tecnicas"
echo.
echo   4) RENDIMIENTO (ESC-7) con k6
echo      Obtener un token y correr:
echo        cd "%ROOT%"
echo        k6 run -e RATE=100 -e DURACION=3m -e SUSCRIPTORES=10 -e TOKEN=^<jwt^> loadtest\escenario-rendimiento.js
echo.
echo   5) SEGURIDAD / MANTENIBILIDAD (ESC-2..6)
echo      Con Docker apagado, en modo desarrollo:
echo        "%ROOT%\Back_NexoVital\scripts\prueba-esc2-autenticacion.ps1"
echo      Suite:  .\mvnw.cmd verify -Pcobertura   (back)
echo              npm run test:coverage            (front)
echo.
echo   APAGAR:  docker compose down        (conserva datos)
echo            docker compose down -v     (borra datos)
echo ============================================================
popd
echo.
pause
exit /b 0

REM ------------------------------------------------------------------
REM Errores
REM ------------------------------------------------------------------
:incomplete
echo.
echo [x] Faltan archivos del proyecto. Volve a clonar o corre "git pull".
echo.
pause
exit /b 1

:docker_missing
echo.
echo [x] No se encontro Docker Desktop.
echo     Instalalo desde https://www.docker.com/products/docker-desktop/
echo     y volve a ejecutar este archivo.
echo.
pause
exit /b 1

:docker_timeout
echo.
echo [x] Docker no arranco en 4 minutos.
echo     Abri Docker Desktop a mano, acepta lo que pida y reintenta.
echo.
pause
exit /b 1

:compose_fail
popd
echo.
echo [x] "docker compose up" fallo. Mira el error de arriba.
echo     Si dice que falta POSTGRES_PASSWORD, revisa "%ROOT%\.env".
echo.
pause
exit /b 1

:health_timeout
echo.
echo [x] La API no respondio en 8 minutos.
echo     Revisa los logs:
echo        docker compose logs --tail=100 backend-1
echo        docker compose logs --tail=100 nginx
echo.
pause
exit /b 1
