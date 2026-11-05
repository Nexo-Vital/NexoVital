<#
.SYNOPSIS
Levanta el laboratorio Citus y carga el esquema distribuido.

.DESCRIPTION
  1. docker compose up -d
  2. espera a que el coordinador este healthy
  3. asegura la extension citus en los workers
  4. ejecuta 01-init.sql, 02-seed.sql y 03-verify.sql

No toca la aplicacion ni la base del compose principal.

.PARAMETER Reset
Borra los volumenes del laboratorio antes de levantar (docker compose down -v).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Reset
#>
param(
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$compose = Join-Path $root 'docker-compose.yml'

function Fallar {
    param([string]$Mensaje)
    Write-Host "[FALLA] $Mensaje"
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fallar 'docker no esta en el PATH.'
}

Push-Location $root
try {
    if ($Reset) {
        Write-Host '[..] borrando volumenes del laboratorio...'
        & docker compose -f $compose down -v
    }

    Write-Host '[..] levantando coordinador y workers...'
    & docker compose -f $compose up -d
    if ($LASTEXITCODE -ne 0) { Fallar 'docker compose up fallo.' }

    Write-Host '[..] esperando al coordinador...'
    $fin = (Get-Date).AddMinutes(2)
    $ok = $false
    while ((Get-Date) -lt $fin) {
        $estado = (& docker inspect -f '{{.State.Health.Status}}' citus-coordinator 2>$null)
        if ($estado -eq 'healthy') { $ok = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $ok) { Fallar 'el coordinador no quedo healthy en 2 minutos.' }

    Write-Host '[..] asegurando la extension citus en los workers...'
    foreach ($worker in @('citus-worker-1', 'citus-worker-2')) {
        & docker compose -f $compose exec -T $worker psql -U postgres -d nexovital -c "CREATE EXTENSION IF NOT EXISTS citus;" | Out-Null
    }

    Write-Host '[..] creando esquema distribuido...'
    & docker compose -f $compose exec -T citus-coordinator psql -U postgres -d nexovital -v ON_ERROR_STOP=1 -f /lab/01-init.sql
    if ($LASTEXITCODE -ne 0) { Fallar '01-init.sql fallo.' }

    Write-Host '[..] sembrando datos...'
    & docker compose -f $compose exec -T citus-coordinator psql -U postgres -d nexovital -v ON_ERROR_STOP=1 -f /lab/02-seed.sql
    if ($LASTEXITCODE -ne 0) { Fallar '02-seed.sql fallo.' }

    Write-Host '[..] verificando cluster y planes...'
    & docker compose -f $compose exec -T citus-coordinator psql -U postgres -d nexovital -v ON_ERROR_STOP=1 -f /lab/03-verify.sql
    if ($LASTEXITCODE -ne 0) { Fallar '03-verify.sql fallo.' }

    Write-Host ''
    Write-Host 'Laboratorio listo.'
    Write-Host '  Coordinador: localhost:5433  (db nexovital, user postgres)'
    Write-Host '  Siguiente:   .\measure-latency.ps1'
    Write-Host '               .\test-concurrencia.ps1'
} finally {
    Pop-Location
}
