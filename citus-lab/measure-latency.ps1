<#
.SYNOPSIS
Mide la diferencia entre un ping de mapa router y uno multi-shard con pgbench.

.DESCRIPTION
Corre dos veces el mismo UPDATE de posicion:

  1. 04-router.sql  -> WHERE ciudad_id + id  (un solo shard)
  2. 04-multi.sql   -> WHERE id solo          (todos los shards)

Compara latencia promedio y TPS. Es la prueba de por que la app debe llevar
`ciudad_id` en la escritura de posicion.

.PARAMETER Seconds
Duracion de cada corrida. Por defecto 10.

.PARAMETER Clients
Clientes concurrentes de pgbench. Por defecto 10.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\measure-latency.ps1
powershell -ExecutionPolicy Bypass -File .\measure-latency.ps1 -Seconds 20 -Clients 20
#>
param(
    [int]$Seconds = 10,
    [int]$Clients = 10
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$compose = Join-Path $root 'docker-compose.yml'

Push-Location $root
try {
    Write-Host ''
    Write-Host '================================================================='
    Write-Host '  ROUTER QUERY - UPDATE ... WHERE ciudad_id = ? AND id = ?'
    Write-Host '  Debe ir a UN solo shard.'
    Write-Host '================================================================='
    & docker compose -f $compose exec -T citus-coordinator `
        pgbench -U postgres -d nexovital -n -T $Seconds -c $Clients -f /lab/04-router.sql

    Write-Host ''
    Write-Host '================================================================='
    Write-Host '  MULTI-SHARD - UPDATE ... WHERE id = ?   (sin ciudad_id)'
    Write-Host '  Citus tiene que buscar en TODOS los shards.'
    Write-Host '================================================================='
    & docker compose -f $compose exec -T citus-coordinator `
        pgbench -U postgres -d nexovital -n -T $Seconds -c $Clients -f /lab/04-multi.sql

    Write-Host ''
    Write-Host 'Comparar: "latency average" y "tps" de cada bloque.'
    Write-Host 'La diferencia es el costo de no incluir la columna de distribucion.'
} finally {
    Pop-Location
}
