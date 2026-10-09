<#
.SYNOPSIS
Live evidence for concurrency challenge C2: "all units accept, only one wins".

.DESCRIPTION
Fires N SIMULTANEOUS accepts (not N sequential accepts) against the SAME request
in the REAL running backend, and asserts the server-side CAS invariant:

  * exactly ONE winner (HTTP 200 with ganador=true)
  * exactly N-1 rejections (HTTP 409) carrying a backend error code
  * ZERO HTTP 500 (no @Version clash, no deadlock leaking as a server error)
  * the losing units stay DISPONIBLE while the winner is EN_MISION
  * the winner's request ends TOMADA and its unit returns DISPONIBLE (cleanup)

It is re-executable: each N uses its own request and the winner finishes the
service, so the run leaves every unit DISPONIBLE again.

N = 2 and N = 5 run against the seeded fleet (Back_NexoVital DataSeeder: five
units ABC101..ABC505 in Suba). N = 20 CANNOT be executed against this deployment:
the backend seeds five units and exposes NO resource to create an ambulance
(only GET /flota/ambulancias, GET /flota/ambulancias/mia and POST
/flota/ambulancias/{id}/posicion exist). The script detects this from the real
notified-unit list and reports the step as NOT EXECUTABLE instead of inventing
units; that skip is not a failure.

State changes: creates one emergency, one request per executed N, and finishes
each request. With the default profile (H2 in memory, create-drop) restarting the
backend resets everything.

.PARAMETER Base
API root. Defaults to the local backend.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\prueba-concurrencia-c2.ps1
#>
param(
    [string]$Base = 'http://localhost:8080/api/v1',
    [string]$CiudadanoEmail = 'ciudadano@nexovital.co',
    [string]$CiudadanoPassword = 'ciudadano123',
    [string]$ConductorPassword = 'conductor123',
    [string[]]$Conductores = @(
        'conductor1@nexovital.co',
        'conductor2@nexovital.co',
        'conductor3@nexovital.co',
        'conductor4@nexovital.co',
        'conductor5@nexovital.co'
    ),
    [int[]]$Ns = @(2, 5, 20)
)

$ErrorActionPreference = 'Stop'
$script:fallos = 0
$script:noEjecutables = 0

# Windows PowerShell 5.1 does not load System.Net.Http by default, so the
# HttpClient types used by the parallel burst must be made available explicitly.
Add-Type -AssemblyName System.Net.Http

function Paso {
    param([string]$Nombre, [bool]$Ok, [string]$Detalle = '')
    if ($Ok) {
        Write-Host "[ OK ] $Nombre"
    } else {
        Write-Host "[FALLA] $Nombre" -ForegroundColor Red
        $script:fallos++
    }
    if ($Detalle) { Write-Host "       $Detalle" }
}

function Omitido {
    param([string]$Nombre, [string]$Motivo)
    Write-Host "[OMITE] $Nombre" -ForegroundColor Yellow
    Write-Host "       $Motivo"
    $script:noEjecutables++
}

function Invoke-Api {
    param([string]$Metodo, [string]$Ruta, [hashtable]$Headers, $Cuerpo)
    $invokeArgs = @{ Method = $Metodo; Uri = "$Base$Ruta"; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($null -ne $Cuerpo) {
        $invokeArgs.ContentType = 'application/json'
        $invokeArgs.Body = ($Cuerpo | ConvertTo-Json -Compress)
    }
    return Invoke-RestMethod @invokeArgs
}

# PowerShell 5.1 does not expose ErrorDetails.Message on a WebException: the body
# must be read from the stream, or a 409 looks like an empty response.
function Leer-CuerpoDeError {
    param($Error_)
    try {
        $stream = $Error_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch {
        return ''
    }
}

# Fire one accept per unit in PARALLEL: every request is started (SendAsync)
# before any response is awaited. The connection limit is raised so the requests
# really overlap instead of queueing two at a time.
function Disparar-Aceptaciones {
    param([string]$SolicitudId, [hashtable]$TokenPorUnidad, [string[]]$UnidadIds)

    # DefaultConnectionLimit defaults to 2 in .NET Framework; without this the
    # accepts would be serialized in pairs, which is NOT the C2 scenario.
    [System.Net.ServicePointManager]::DefaultConnectionLimit = [Math]::Max(100, $UnidadIds.Count + 10)
    [System.Net.ServicePointManager]::Expect100Continue = $false

    $handler = New-Object System.Net.Http.HttpClientHandler
    try { $handler.MaxConnectionsPerServer = 200 } catch { }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(30)

    $reloj = [System.Diagnostics.Stopwatch]::StartNew()
    $pendientes = New-Object System.Collections.ArrayList
    foreach ($uid in $UnidadIds) {
        $request = New-Object System.Net.Http.HttpRequestMessage(
            [System.Net.Http.HttpMethod]::Post, "$Base/solicitudes/$SolicitudId/accept")
        $request.Headers.Authorization =
            New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $TokenPorUnidad[$uid])
        $json = (@{ ambulanciaId = $uid } | ConvertTo-Json -Compress)
        $request.Content = New-Object System.Net.Http.StringContent(
            $json, [System.Text.Encoding]::UTF8, 'application/json')
        # Starts the request and returns immediately; nothing is awaited yet.
        [void]$pendientes.Add([pscustomobject]@{ UnidadId = $uid; Tarea = $client.SendAsync($request) })
    }

    $resultados = @()
    foreach ($p in $pendientes) {
        $respuesta = $p.Tarea.GetAwaiter().GetResult()
        $cuerpo = $respuesta.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $resultados += [pscustomobject]@{
            UnidadId = $p.UnidadId
            Http     = [int]$respuesta.StatusCode
            Cuerpo   = $cuerpo
        }
    }
    $reloj.Stop()
    $client.Dispose()
    return [pscustomobject]@{ TotalMs = $reloj.ElapsedMilliseconds; Resultados = $resultados }
}

# Reads the fleet and returns unit id -> estado (Spanish domain literal).
# Assign the call to a variable before enumerating: in PowerShell 5.1,
# `@(Invoke-Api ...)` collapses a JSON array returned by a function into a
# single object, while `@($var)` enumerates it correctly.
function EstadoDeUnidades {
    param([hashtable]$Headers)
    $mapa = @{}
    $unidades = Invoke-Api -Metodo GET -Ruta '/flota/ambulancias' -Headers $Headers
    foreach ($u in @($unidades)) {
        $mapa[$u.id] = $u.estado
    }
    return $mapa
}

Write-Host ''
Write-Host '=== Prueba de concurrencia C2: todas aceptan, gana una ==='
Write-Host "backend: $Base"
Write-Host "N a probar: $($Ns -join ', ')"
Write-Host ''

# --- 1. login ciudadano + conductores ---------------------------------------
try {
    $sesionCiudadano = Invoke-Api -Metodo POST -Ruta '/sesiones' -Headers @{} `
        -Cuerpo @{ email = $CiudadanoEmail; password = $CiudadanoPassword }
    $headersCiudadano = @{ Authorization = "Bearer $($sesionCiudadano.token)" }
    Paso 'PASO 1  login ciudadano' $true "rol=$($sesionCiudadano.usuario.rol)"
} catch {
    Paso 'PASO 1  login ciudadano' $false "el backend no responde en $Base ($($_.Exception.Message))"
    Write-Host 'No se puede seguir sin backend.' -ForegroundColor Red
    exit 1
}

# unit id -> bearer token of the driver that owns it.
$tokenPorUnidad = @{}
$emailPorUnidad = @{}
foreach ($email in $Conductores) {
    try {
        $sesion = Invoke-Api -Metodo POST -Ruta '/sesiones' -Headers @{} `
            -Cuerpo @{ email = $email; password = $ConductorPassword }
        $headers = @{ Authorization = "Bearer $($sesion.token)" }
        $mia = Invoke-Api -Metodo GET -Ruta '/flota/ambulancias/mia' -Headers $headers
        if ($null -eq $mia -or -not $mia.id) {
            Write-Host "       (sin ambulancia) $email"
            continue
        }
        $tokenPorUnidad[$mia.id] = $sesion.token
        $emailPorUnidad[$mia.id] = $email
        # Una sesion previa del front pudo dejar la unidad desconectada; la prueba la reconecta.
        $null = Invoke-Api -Metodo POST -Ruta '/flota/ambulancias/mia/conectar' -Headers $headers
    } catch {
        Write-Host "       (login falló) $email : $($_.Exception.Message)"
    }
}
Paso 'PASO 2  login de conductores y sus unidades' ($tokenPorUnidad.Count -gt 0) `
    "unidades con conductor: $($tokenPorUnidad.Count) / $($Conductores.Count)"

$estadoInicial = EstadoDeUnidades -Headers $headersCiudadano
$disponiblesIniciales = @($estadoInicial.Keys | Where-Object { $estadoInicial[$_] -eq 'DISPONIBLE' }).Count
Paso 'PASO 3  inventario de unidades DISPONIBLE' ($disponiblesIniciales -gt 0) `
    "disponibles=$disponiblesIniciales de $($estadoInicial.Count)"
if ($disponiblesIniciales -lt $estadoInicial.Count) {
    Write-Host '       AVISO: hay unidades ocupadas; el limite por corrida se calcula con las notificadas.' -ForegroundColor Yellow
}

# --- 4. anclas: emergencia real y centro de ayuda real ----------------------
$emergencia = Invoke-Api -Metodo POST -Ruta '/emergencias' -Headers $headersCiudadano `
    -Cuerpo @{ ubicacion = @{ lat = 4.736; lng = -74.082 }; tipo = 'ACCIDENTE'; nivel = 'ALTO'; descripcion = 'Evidencia C2: aceptacion simultanea' }
Paso 'PASO 4  emergencia real de anclaje' ($null -ne $emergencia.id) "emergenciaId=$($emergencia.id)"

$mapa = Invoke-Api -Metodo GET -Ruta '/mapa' -Headers $headersCiudadano
$centro = $null
foreach ($c in @($mapa.centros)) { if ($c.tipo -eq 'CENTRO_ACOPIO') { $centro = $c; break } }
if ($null -eq $centro) {
    Paso 'PASO 5  centro de ayuda de anclaje' $false 'no hay CENTRO_ACOPIO en GET /mapa'
    exit 1
}
Paso 'PASO 5  centro de ayuda de anclaje' $true "$($centro.nombre) ($($centro.id))"

# --- 6. N simultaneous accepts per value ------------------------------------
$resumen = @()
foreach ($n in $Ns) {
    Write-Host ''
    Write-Host "--- N = $n ---"

    $antes = EstadoDeUnidades -Headers $headersCiudadano
    $disponiblesAntes = @($antes.Keys | Where-Object { $antes[$_] -eq 'DISPONIBLE' }).Count

    # A broadcast notifies exactly the available units of the zone, so N distinct
    # units need N available units. The backend exposes no ambulance-creation
    # resource, so a larger N is not executable here: report the real limit
    # instead of inventing units, and do not create a request we cannot use.
    if ($n -gt $disponiblesAntes) {
        Omitido "N=$n  aceptaciones simultaneas" `
            "hay $disponiblesAntes unidades DISPONIBLE y el backend no expone forma de crear mas (no existe POST /flota/ambulancias). Hacen falta $n unidades simultaneas; se documenta el limite real en lugar de inventarlas."
        $resumen += [pscustomobject]@{ N = $n; Ejecutado = $false; Ganador = 0; Rechazos = 0; Errores500 = 0; Codigos = '' }
        continue
    }

    $solicitud = Invoke-Api -Metodo POST -Ruta '/solicitudes' -Headers $headersCiudadano `
        -Cuerpo @{ ubicacion = @{ lat = 4.736; lng = -74.082 }; emergenciaId = $emergencia.id; centroAyudaId = $centro.id; zonaId = 'Suba'; timeoutEn = $null }
    $solicitudId = $solicitud.id
    $notificadas = @($solicitud.ambulanciasNotificadas)
    Write-Host "       solicitud=$solicitudId notificadas=$($notificadas.Count)"

    $unidadesAceptantes = @($notificadas | Select-Object -First $n)
    $burst = Disparar-Aceptaciones -SolicitudId $solicitudId -TokenPorUnidad $tokenPorUnidad -UnidadIds $unidadesAceptantes

    $ganadores = @($burst.Resultados | Where-Object { $_.Http -eq 200 })
    $rechazos = @($burst.Resultados | Where-Object { $_.Http -eq 409 })
    $errores = @($burst.Resultados | Where-Object { $_.Http -ge 500 })
    $codigos = @()
    foreach ($r in $rechazos) {
        $codigo = ''
        try { $codigo = ($r.Cuerpo | ConvertFrom-Json).codigo } catch { $codigo = '(sin codigo)' }
        $codigos += $codigo
    }

    Write-Host "       respuestas: 200=$($ganadores.Count) 409=$($rechazos.Count) 5xx=$($errores.Count) en $($burst.TotalMs) ms"
    Write-Host "       codigos 409: $([string]::Join(', ', $codigos))"

    # A single accept body is the winner's proof.
    $detalleGanador = ''
    if ($ganadores.Count -eq 1) {
        try {
            $b = $ganadores[0].Cuerpo | ConvertFrom-Json
            $detalleGanador = "ganador=$($ganadores[0].UnidadId) ganadorFlag=$($b.ganador) estado=$($b.solicitud.estado)"
        } catch { $detalleGanador = "ganador=$($ganadores[0].UnidadId)" }
    }

    Paso "N=$n  exactamente un ganador (200)" ($ganadores.Count -eq 1) $detalleGanador
    Paso "N=$n  $($n-1) rechazos 409 del backend" ($rechazos.Count -eq ($n - 1)) `
        "409=$($rechazos.Count) esperados=$($n-1)"
    Paso "N=$n  ningun 500" ($errores.Count -eq 0) "5xx=$($errores.Count)"
    $codigosValidos = $codigos.Count -eq ($n - 1) -and (@($codigos | Where-Object { $_ -eq '' -or $_ -eq '(sin codigo)' }).Count -eq 0)
    Paso "N=$n  los 409 traen codigo de error del backend" $codigosValidos "codigos=$([string]::Join(',', $codigos))"

    # Winner must be EN_MISION; every accepting unit that lost must stay DISPONIBLE.
    $despues = EstadoDeUnidades -Headers $headersCiudadano
    $ganadorId = if ($ganadores.Count -eq 1) { $ganadores[0].UnidadId } else { $null }
    $perdedores = @($unidadesAceptantes | Where-Object { $_ -ne $ganadorId })
    $ganadorOk = $null -ne $ganadorId -and $despues[$ganadorId] -eq 'EN_MISION'
    $perdedoresOk = $true
    foreach ($uid in $perdedores) { if ($despues[$uid] -ne 'DISPONIBLE') { $perdedoresOk = $false } }
    Paso "N=$n  la ganadora queda EN_MISION" $ganadorOk `
        $(if ($ganadorId) { "$ganadorId -> $($despues[$ganadorId])" } else { 'sin ganador' })
    Paso "N=$n  las unidades perdedoras quedan DISPONIBLE" $perdedoresOk `
        "perdedoras=$($perdedores.Count)"

    # Cleanup: the winner finishes the service; the request closes and its unit
    # returns to DISPONIBLE.
    $cierreOk = $false
    if ($null -ne $ganadorId -and $tokenPorUnidad.ContainsKey($ganadorId)) {
        $headersGanador = @{ Authorization = "Bearer $($tokenPorUnidad[$ganadorId])" }
        try {
            # Finalizar exige la llegada declarada y confirmada por el ciudadano.
            Invoke-Api -Metodo POST -Ruta "/solicitudes/$solicitudId/llegada" -Headers $headersGanador `
                -Cuerpo @{ ambulanciaId = $ganadorId } | Out-Null
            Invoke-Api -Metodo POST -Ruta "/solicitudes/$solicitudId/confirmar" -Headers $headersCiudadano | Out-Null
            $cerrada = Invoke-Api -Metodo POST -Ruta "/solicitudes/$solicitudId/finalizar" -Headers $headersGanador `
                -Cuerpo @{ ambulanciaId = $ganadorId }
            $final = EstadoDeUnidades -Headers $headersCiudadano
            $cierreOk = ($cerrada.estado -eq 'TOMADA') -and ($final[$ganadorId] -eq 'DISPONIBLE')
            if ($cierreOk) {
                Paso "N=$n  cierre: solicitud TOMADA y unidad DISPONIBLE" $true `
                    "estado=$($cerrada.estado) unidad=$($final[$ganadorId])"
            }
        } catch {
            Paso "N=$n  cierre de la solicitud" $false "finalizar fallo: $($_.Exception.Message)"
        }
    }
    if (-not $cierreOk) {
        Paso "N=$n  cierre: solicitud TOMADA y unidad DISPONIBLE" $false 'la solicitud o la unidad no volvieron al estado esperado'
    }

    $resumen += [pscustomobject]@{
        N = $n; Ejecutado = $true; Ganador = $ganadores.Count; Rechazos = $rechazos.Count
        Errores500 = $errores.Count; Codigos = [string]::Join(',', $codigos)
    }
}

# --- resumen ----------------------------------------------------------------
Write-Host ''
Write-Host '=== RESUMEN ==='
foreach ($r in $resumen) {
    if ($r.Ejecutado) {
        Write-Host "N=$($r.N): 200=$($r.Ganador) 409=$($r.Rechazos) 5xx=$($r.Errores500) codigos=[$($r.Codigos)]"
    } else {
        Write-Host "N=$($r.N): no ejecutable en este despliegue (ver motivo arriba)"
    }
}
$finalEstado = EstadoDeUnidades -Headers $headersCiudadano
$ocupadas = @($finalEstado.Keys | Where-Object { $finalEstado[$_] -ne 'DISPONIBLE' })
Write-Host "estado final de unidades: $($finalEstado.Count) total, $($ocupadas.Count) no disponibles"

Write-Host ''
if ($script:fallos -eq 0) {
    Write-Host "RESULTADO: TODOS LOS PASOS PASARON ($($script:noEjecutables) no ejecutable(s) documentado(s))" -ForegroundColor Green
    exit 0
} else {
    Write-Host "RESULTADO: $($script:fallos) paso(s) FALLARON" -ForegroundColor Red
    exit 1
}
