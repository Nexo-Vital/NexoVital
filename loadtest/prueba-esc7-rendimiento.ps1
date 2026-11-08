<#
.SYNOPSIS
Ejecuta la prueba de rendimiento ESC-7 con k6 contra el compose de NexoVital.

.DESCRIPTION
Envuelve `loadtest/escenario-rendimiento.js` para que la corrida sea un solo
comando y siempre deje el resumen en JSON.

Valida antes de correr:
  - que k6 exista en el PATH;
  - que haya un token de Firebase;
  - que http://localhost:8080/actuator/health responda 200.

Umbrales que aplica el script de k6:
  http_req_duration  p95 < 500 ms, p99 < 1000 ms
  http_req_failed    < 1 %
  checks             > 99 %
  huecos_detectados  == 0  (con -Consecutivo)

El token es una credencial: no se imprime, no se escribe a disco y no se pasa
por la linea de comandos. Se toma de -Token o de $env:TOKEN.

.PARAMETER Token
ID token de Firebase. Si se omite, se usa $env:TOKEN.

.PARAMETER Rate
Peticiones HTTP por segundo de la meseta. Por defecto 100.

.PARAMETER Duracion
Duracion de la meseta HTTP. Por defecto 3m.

.PARAMETER Suscriptores
Clientes STOMP concurrentes. Por defecto 10.

.PARAMETER SinConsecutivo
No exige el control de huecos. Útil si el backend no instrumenta `consecutivo`.

.PARAMETER Base
Raiz HTTP. Por defecto http://localhost:8080.

.PARAMETER WsBase
Raiz WebSocket. Por defecto ws://localhost:8080/ws.

.PARAMETER Resumen
Nombre del JSON de resumen. Se escribe junto a este script.

.EXAMPLE
$env:TOKEN = "<id-token>"
powershell -ExecutionPolicy Bypass -File loadtest\prueba-esc7-rendimiento.ps1 `
    -Rate 100 -Duracion 3m -Suscriptores 10

.EXAMPLE
# corrida de humo de 30 segundos
$env:TOKEN = "<id-token>"
powershell -ExecutionPolicy Bypass -File loadtest\prueba-esc7-rendimiento.ps1 `
    -Rate 10 -Duracion 30s -Suscriptores 2
#>
param(
    [string]$Token = $env:TOKEN,
    [int]$Rate = 100,
    [string]$Duracion = '3m',
    [int]$Suscriptores = 10,
    [switch]$SinConsecutivo,
    [string]$Base = 'http://localhost:8080',
    [string]$WsBase = 'ws://localhost:8080/ws',
    [string]$Resumen = 'resultado-esc7.json'
)

$ErrorActionPreference = 'Stop'

function Fallar {
    param([string]$Mensaje)
    Write-Host "[FALLA] $Mensaje"
    exit 1
}

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Fallar 'k6 no esta en el PATH. Instalalo o abri una consola nueva.'
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    Fallar 'Falta el token. Pasa -Token o define $env:TOKEN con un idToken de Firebase.'
}

try {
    $salud = Invoke-WebRequest -UseBasicParsing "$Base/actuator/health" -TimeoutSec 5
    if ($salud.StatusCode -ne 200) {
        Fallar "health devolvio $($salud.StatusCode)."
    }
} catch {
    Fallar "El backend no responde en $Base. Levanta el compose con demo.cmd."
}

$escenario = Join-Path $PSScriptRoot 'escenario-rendimiento.js'
if (-not (Test-Path $escenario)) {
    Fallar "No encuentro $escenario"
}

$consecutivo = if ($SinConsecutivo) { 'false' } else { 'true' }
$salida = Join-Path $PSScriptRoot $Resumen

Write-Host ''
Write-Host '================================================================='
Write-Host '  ESC-7 - Rendimiento (k6)'
Write-Host "  base:         $Base"
Write-Host "  rate:         $Rate req/s"
Write-Host "  duracion:     $Duracion"
Write-Host "  suscriptores: $Suscriptores"
Write-Host "  consecutivo:  $consecutivo"
Write-Host "  resumen:      $salida"
Write-Host '================================================================='
Write-Host ''

# El token viaja por variable de entorno, no por argv: argv queda visible en
# el listado de procesos.
$env:TOKEN = $Token

& k6 run `
    -e "BASE_URL=$Base" `
    -e "WS_BASE=$WsBase" `
    -e "RATE=$Rate" `
    -e "DURACION=$Duracion" `
    -e "SUSCRIPTORES=$Suscriptores" `
    -e "CONSECUTIVO=$consecutivo" `
    --summary-export $salida `
    $escenario

$codigo = $LASTEXITCODE
Write-Host ''
if ($codigo -eq 0) {
    Write-Host 'RESULTADO: thresholds OK.'
} elseif ($codigo -eq 99) {
    Write-Host 'RESULTADO: algun threshold fallo. Mira las lineas marcadas con X en la salida.'
} else {
    Write-Host "RESULTADO: k6 termino con codigo $codigo."
}
Write-Host "Resumen JSON: $salida"
exit $codigo
