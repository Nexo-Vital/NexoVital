<#
.SYNOPSIS
Prueba C2 en el laboratorio: dos accepts concurrentes sobre la misma ambulancia.

.DESCRIPTION
El registro `flota.misiones_activas` vive en el coordinador y tiene PK
`ambulancia_id`. Dos INSERT ... ON CONFLICT (ambulancia_id) DO NOTHING
concurrentes, con solicitudes distintas:

  * 1 inserta (gana la mision)
  * 1 no inserta (la ambulancia ya esta ocupada)
  * el conteo final para esa ambulancia debe ser 1

No es una transaccion distribuida: es el CAS global que preserva C2 sin
importar en que shard esten las tablas grandes.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\test-concurrencia.ps1
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$compose = Join-Path $root 'docker-compose.yml'

$amb = '00000001-0000-0000-0000-000000000001'
$ciudad = '11111111-1111-1111-1111-111111111111'
$solA = 'a0000000-0000-0000-0000-000000000001'
$solB = 'b0000000-0000-0000-0000-000000000001'

function Sql {
    param([string]$Consulta)
    return (& docker compose -f $compose exec -T citus-coordinator `
        psql -U postgres -d nexovital -v ON_ERROR_STOP=1 -t -A -c $Consulta) | Select-Object -Last 1
}

Push-Location $root
try {
    Write-Host '[..] limpiando el registro para la ambulancia de prueba...'
    Sql "DELETE FROM flota.misiones_activas WHERE ambulancia_id = '$amb';" | Out-Null

    $sqlA = "INSERT INTO flota.misiones_activas (ambulancia_id, solicitud_id, ciudad_id) VALUES ('$amb', '$solA', '$ciudad') ON CONFLICT (ambulancia_id) DO NOTHING;"
    $sqlB = "INSERT INTO flota.misiones_activas (ambulancia_id, solicitud_id, ciudad_id) VALUES ('$amb', '$solB', '$ciudad') ON CONFLICT (ambulancia_id) DO NOTHING;"

    Write-Host '[..] lanzando dos accepts concurrentes...'
    $jobA = Start-Job -ScriptBlock {
        param($compose, $sql)
        & docker compose -f $compose exec -T citus-coordinator psql -U postgres -d nexovital -v ON_ERROR_STOP=1 -c $sql
    } -ArgumentList $compose, $sqlA

    $jobB = Start-Job -ScriptBlock {
        param($compose, $sql)
        & docker compose -f $compose exec -T citus-coordinator psql -U postgres -d nexovital -v ON_ERROR_STOP=1 -c $sql
    } -ArgumentList $compose, $sqlB

    Wait-Job $jobA, $jobB | Out-Null
    $salidaA = Receive-Job $jobA
    $salidaB = Receive-Job $jobB
    Remove-Job $jobA, $jobB

    $filas = [int](Sql "SELECT count(*) FROM flota.misiones_activas WHERE ambulancia_id = '$amb';")
    $ganadora = Sql "SELECT solicitud_id FROM flota.misiones_activas WHERE ambulancia_id = '$amb';"

    Write-Host ''
    Write-Host 'Resultado:'
    Write-Host "  filas para la ambulancia : $filas  (esperado: 1)"
    Write-Host "  solicitud ganadora       : $ganadora"

    if ($filas -eq 1) {
        Write-Host '  [OK] C2 se sostiene: una ambulancia, una mision.'
    } else {
        Write-Host '  [FALLA] C2 roto: hay mas de una mision para la misma ambulancia.'
        exit 1
    }
} finally {
    Pop-Location
}
