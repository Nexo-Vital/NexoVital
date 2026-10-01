@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
title Nexo Vital - launcher

echo ============================================================
echo   Nexo Vital - levanta FRONT y BACK en un clic
echo ============================================================
echo.

REM ------------------------------------------------------------------
REM 0) Las carpetas tienen que estar completas (si no, error claro)
REM ------------------------------------------------------------------
if not exist "%ROOT%\Back_NexoVital\pom.xml" goto :incomplete
if not exist "%ROOT%\Front_NexoVital\package.json" goto :incomplete

REM ------------------------------------------------------------------
REM 1) Requisitos: instala lo que falte con winget
REM ------------------------------------------------------------------
where winget >nul 2>nul
if errorlevel 1 echo [aviso] winget no esta disponible; si falta algo habra que instalarlo a mano.

set "INSTALLED="

where node >nul 2>nul
if errorlevel 1 call :install OpenJS.NodeJS.LTS "Node.js"
where java >nul 2>nul
if errorlevel 1 call :install EclipseAdoptium.Temurin.21.JDK "Java 21 (Temurin)"
where mvn >nul 2>nul
if errorlevel 1 call :install Apache.Maven "Maven"

if defined INSTALLED goto :re_run

echo [ok] Node, Java 21 y Maven disponibles.
echo.

REM ------------------------------------------------------------------
REM 2) Puertos ocupados (avisamos, nunca matamos procesos ajenos)
REM ------------------------------------------------------------------
set "OPEN_BROWSER=1"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 echo [aviso] el puerto 8080 ya esta ocupado: si no es otro back corriendo, cerralo.

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 goto :port_5173_busy
echo.

REM ------------------------------------------------------------------
REM 3) Dependencias del front
REM ------------------------------------------------------------------
if not exist "%ROOT%\Front_NexoVital\node_modules" goto :npm_install
goto :secret

:port_5173_busy
echo [aviso] el puerto 5173 ya esta ocupado: Vite va a elegir otro y no abro el navegador solo.
set "OPEN_BROWSER=0"
echo.

REM ------------------------------------------------------------------
REM 4) Secreto JWT de desarrollo (nunca se guarda en el repo)
REM ------------------------------------------------------------------
:secret
if not "%NEXOVITAL_JWT_SECRET%"=="" goto :secret_ready
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$b=New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)"`) do set "NEXOVITAL_JWT_SECRET=%%S"
:secret_ready
if "%NEXOVITAL_JWT_SECRET%"=="" goto :secret_fail
echo [ok] NEXOVITAL_JWT_SECRET generado solo para esta sesion (no se versiona).
echo.

REM ------------------------------------------------------------------
REM 5) Back
REM ------------------------------------------------------------------
echo [..] levantando el BACK en http://localhost:8080 ...
start "NexoVital back" /d "%ROOT%\Back_NexoVital" cmd /k "set NEXOVITAL_JWT_SECRET=%NEXOVITAL_JWT_SECRET% && mvn spring-boot:run"

echo [..] esperando al back. La PRIMERA vez Maven compila y descarga dependencias: puede tardar varios minutos.
powershell -NoProfile -Command "$end=(Get-Date).AddMinutes(10); while((Get-Date) -lt $end){ try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8080); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 800 } }; exit 1"
if errorlevel 1 goto :back_timeout
echo [ok] back arriba en 8080.
echo.

REM ------------------------------------------------------------------
REM 6) Front + navegador
REM ------------------------------------------------------------------
echo [..] levantando el FRONT en http://localhost:5173 ...
start "NexoVital front" /d "%ROOT%\Front_NexoVital" cmd /k "npm run dev"

powershell -NoProfile -Command "Start-Sleep -Seconds 6"
if "%OPEN_BROWSER%"=="1" start "" http://localhost:5173

echo.
echo [ok] Listo:
echo      back  -^> http://localhost:8080   (Swagger en /swagger-ui.html)
echo      front -^> http://localhost:5173
echo      Para apagar, cerra las ventanas "NexoVital back" y "NexoVital front".
echo.
pause
exit /b 0

REM ------------------------------------------------------------------
REM Etiquetas
REM ------------------------------------------------------------------
:incomplete
echo.
echo [x] Las carpetas del proyecto estan incompletas:
echo     falta "Back_NexoVital\pom.xml" o "Front_NexoVital\package.json".
echo     Volve a clonar el repositorio, o corre "git pull", y reintenta.
echo.
pause
exit /b 1

:install
echo [falta] %~2 -- instalando con winget: %~1
winget install --id %~1 -e --accept-package-agreements --accept-source-agreements
set "INSTALLED=1"
exit /b 0

:re_run
echo.
echo [!] Se instalo software nuevo y winget no refresca el PATH de esta ventana.
echo     Cerra esta ventana, abri una nueva y volve a ejecutar run.cmd.
echo.
pause
exit /b 1

:npm_install
echo [..] primera vez: instalando dependencias del front (puede tardar bastante)...
pushd "%ROOT%\Front_NexoVital"
call npm install
if errorlevel 1 goto :npm_fail
popd
echo.
goto :secret

:npm_fail
popd
echo.
echo [x] fallo "npm install". Mira el error de arriba y volve a intentar.
echo.
pause
exit /b 1

:secret_fail
echo.
echo [x] no se pudo generar NEXOVITAL_JWT_SECRET.
echo     Defini uno a mano de al menos 32 bytes y volve a ejecutar:
echo         set NEXOVITAL_JWT_SECRET=una-clave-de-desarrollo-de-32-bytes-o-mas
echo.
pause
exit /b 1

:back_timeout
echo.
echo [x] el back no respondio en 8080 en 10 minutos.
echo     Mira la ventana "NexoVital back": ahi esta el error real.
echo.
pause
exit /b 1
