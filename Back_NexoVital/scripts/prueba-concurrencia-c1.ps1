<#
.SYNOPSIS
Evidencia EN VIVO del reto de concurrencia C1: un recurso finito nunca se
asigna mas veces de las que existe.

.DESCRIPTION
Corre contra un backend REAL (la nube o el local) y dispara rafagas
SIMULTANEAS (no secuenciales) sobre UN MISMO insumo de un centro de acopio:

  Fase A - despachos simultaneos (EP-03.F1, CAS sobre el stock):
    N despachos de k unidades piden en total MAS de lo que hay.
    * exactamente floor(stock / k) reciben 200; el resto, 409 STOCK_INSUFICIENTE
    * cero 500
    * el stock final es exactamente stock - ganadores * k, y nunca negativo

  Fase B - donaciones simultaneas (EP-03.F3, tope en lo que falta):
    M donantes ofrecen a la vez mas de lo que falta para completar la necesidad.
    * la suma aceptada es EXACTAMENTE lo que faltaba (ni una unidad de mas)
    * los que llegan cuando ya esta cubierto reciben 409 NECESIDAD_CUBIERTA
    * cero 500
    * el insumo queda en disponible = requerido

La fase B deja el insumo lleno, asi que la prueba se puede repetir.

.PARAMETER Base
Raiz de la API. Para la nube: https://<FRONT_FQDN>/api/v1

.PARAMETER Despachos
Cuantos despachos simultaneos (N). Por defecto 20.

.PARAMETER Donaciones
Cuantas donaciones simultaneas (M). Por defecto 20.

.PARAMETER Centro
Nombre del centro de acopio. Por defecto 'Acopio Tibabuyes'.

.PARAMETER Insumo
Nombre del insumo. Por defecto 'Agua potable'.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\prueba-concurrencia-c1.ps1 -Base https://<FRONT_FQDN>/api/v1
#>
param(
    [string]$Base = 'http://localhost:8080/api/v1',
    [int]$Despachos = 20,
    [int]$Donaciones = 20,
    [string]$Centro = 'Acopio Tibabuyes',
    [string]$Insumo = 'Agua potable',
    [string]$AdminEmail = 'admin@nexovital.co',
    [string]$AdminPassword = 'admin123',
    [string[]]$Donantes = @(
        'ciudadano@nexovital.co:ciudadano123',
        'ciudadano2@nexovital.co:ciudadano123',
        'rangel@nexovital.co:rangel123',
        'centro@nexovital.co:centro123',
        'acopio@nexovital.co:acopio123',
        'conductor1@nexovital.co:conductor123',
        'conductor2@nexovital.co:conductor123',
        'conductor3@nexovital.co:conductor123'
    )
)

$ErrorActionPreference = 'Stop'
$script:fallos = 0

# Windows PowerShell 5.1: HTTPS de Azure exige TLS 1.2, y HttpClient no viene cargado.
[System.Net.ServicePointManager]::SecurityProtocol = `
    [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
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

function Invoke-Api {
    param([string]$Metodo, [string]$Ruta, [hashtable]$Headers, $Cuerpo)
    $invokeArgs = @{ Method = $Metodo; Uri = "$Base$Ruta"; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 90 }
    if ($null -ne $Cuerpo) {
        $invokeArgs.ContentType = 'application/json'
        $invokeArgs.Body = ($Cuerpo | ConvertTo-Json -Compress)
    }
    return Invoke-RestMethod @invokeArgs
}

function Login {
    param([string]$Email, [string]$Password)
    $s = Invoke-Api -Metodo POST -Ruta '/sesiones' -Headers @{} -Cuerpo @{ email = $Email; password = $Password }
    return $s.token
}

# Lanza TODAS las peticiones (SendAsync) antes de esperar alguna respuesta: asi
# se solapan de verdad en el servidor. Cada elemento de $Peticiones trae Token y Cuerpo.
function Disparar-Rafaga {
    param([string]$Ruta, [object[]]$Peticiones)

    # En .NET Framework el limite por defecto es 2 conexiones: sin esto la rafaga
    # se serializaria de a dos y no seria el escenario de C1.
    [System.Net.ServicePointManager]::DefaultConnectionLimit = [Math]::Max(100, $Peticiones.Count + 10)
    [System.Net.ServicePointManager]::Expect100Continue = $false

    $handler = New-Object System.Net.Http.HttpClientHandler
    try { $handler.MaxConnectionsPerServer = 200 } catch { }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(90)

    $reloj = [System.Diagnostics.Stopwatch]::StartNew()
    $pendientes = New-Object System.Collections.ArrayList
    foreach ($p in $Peticiones) {
        $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, "$Base$Ruta")
        $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $p.Token)
        $json = ($p.Cuerpo | ConvertTo-Json -Compress)
        $request.Content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
        [void]$pendientes.Add($client.SendAsync($request))
    }

    $resultados = @()
    foreach ($tarea in $pendientes) {
        $respuesta = $tarea.GetAwaiter().GetResult()
        $cuerpo = $respuesta.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $json = $null
        try { $json = $cuerpo | ConvertFrom-Json } catch { }
        $resultados += [pscustomobject]@{ Http = [int]$respuesta.StatusCode; Json = $json }
    }
    $reloj.Stop()
    $client.Dispose()
    return [pscustomobject]@{ TotalMs = $reloj.ElapsedMilliseconds; Resultados = $resultados }
}

function Leer-Item {
    param([string]$CentroId, [string]$ItemId, [hashtable]$Headers)
    $items = Invoke-Api -Metodo GET -Ruta "/centros-acopio/$CentroId/inventario" -Headers $Headers
    foreach ($i in @($items)) { if ($i.id -eq $ItemId) { return $i } }
    return $null
}

function Codigos {
    param([object[]]$Respuestas)
    $lista = @()
    foreach ($r in $Respuestas) {
        if ($null -ne $r.Json -and $r.Json.codigo) { $lista += $r.Json.codigo } else { $lista += '(sin codigo)' }
    }
    return $lista
}

Write-Host ''
Write-Host '=== Prueba de concurrencia C1: el recurso finito no se sobreasigna ==='
Write-Host "backend: $Base"
Write-Host ''

# --- 1. sesiones -------------------------------------------------------------
try {
    $tokenAdmin = Login -Email $AdminEmail -Password $AdminPassword
    $hAdmin = @{ Authorization = "Bearer $tokenAdmin" }
    Paso 'PASO 1  login del administrador (despacha)' $true $AdminEmail
} catch {
    Paso 'PASO 1  login del administrador (despacha)' $false "el backend no responde en $Base ($($_.Exception.Message))"
    exit 1
}
$tokensDonantes = @()
foreach ($d in $Donantes) {
    $partes = $d.Split(':', 2)
    try { $tokensDonantes += (Login -Email $partes[0] -Password $partes[1]) } catch { Write-Host "       (login fallo) $($partes[0])" }
}
Paso 'PASO 2  login de donantes' ($tokensDonantes.Count -gt 0) "donantes con sesion: $($tokensDonantes.Count)"

# --- 2. insumo bajo prueba -----------------------------------------------------
$mapa = Invoke-Api -Metodo GET -Ruta '/mapa' -Headers $hAdmin
$centroObj = $null
foreach ($c in @($mapa.centros)) { if ($c.tipo -eq 'CENTRO_ACOPIO' -and $c.nombre -eq $Centro) { $centroObj = $c } }
if ($null -eq $centroObj) {
    Paso 'PASO 3  centro de acopio' $false "no existe '$Centro' en GET /mapa"
    exit 1
}
$items = Invoke-Api -Metodo GET -Ruta "/centros-acopio/$($centroObj.id)/inventario" -Headers $hAdmin
$item = $null
foreach ($i in @($items)) { if ($i.nombre -eq $Insumo) { $item = $i } }
if ($null -eq $item) {
    Paso 'PASO 3  insumo' $false "el centro '$Centro' no tiene '$Insumo'"
    exit 1
}
Paso 'PASO 3  insumo bajo prueba' $true "$Insumo en $Centro : disponible=$($item.disponible) requerido=$($item.requerido)"

# Si una corrida anterior lo dejo a medias, primero se completa.
if ($item.disponible -lt $item.requerido) {
    $falta = $item.requerido - $item.disponible
    [void](Invoke-Api -Metodo POST -Ruta "/centros-acopio/$($centroObj.id)/inventario/donacion" -Headers $hAdmin `
        -Cuerpo @{ itemId = $item.id; cantidad = $falta })
    $item = Leer-Item -CentroId $centroObj.id -ItemId $item.id -Headers $hAdmin
    Write-Host "       (se completo el insumo antes de empezar: disponible=$($item.disponible))"
}
$stock = [int]$item.disponible
if ($stock -lt 1) {
    Paso 'PASO 3  hay stock para despachar' $false 'el insumo no tiene unidades disponibles'
    exit 1
}

# --- 3. Fase A: despachos simultaneos -----------------------------------------
# k se elige para que la demanda total sea ~el doble del stock: gana la mitad.
$mitad = [Math]::Max(1, [Math]::Floor($Despachos / 2))
$k = [int][Math]::Max(1, [Math]::Floor($stock / $mitad))
$esperados = [int][Math]::Min($Despachos, [Math]::Floor($stock / $k))
Write-Host ''
Write-Host "--- Fase A: $Despachos despachos simultaneos de $k unidades (stock $stock, demanda $($Despachos * $k)) ---"

$peticiones = @()
for ($n = 0; $n -lt $Despachos; $n++) { $peticiones += [pscustomobject]@{ Token = $tokenAdmin; Cuerpo = @{ itemId = $item.id; cantidad = $k } } }
$rafaga = Disparar-Rafaga -Ruta "/centros-acopio/$($centroObj.id)/inventario/despacho" -Peticiones $peticiones

$ok = @($rafaga.Resultados | Where-Object { $_.Http -eq 200 })
$r409 = @($rafaga.Resultados | Where-Object { $_.Http -eq 409 })
$r5xx = @($rafaga.Resultados | Where-Object { $_.Http -ge 500 })
$otros = @($rafaga.Resultados | Where-Object { $_.Http -ne 200 -and $_.Http -ne 409 -and $_.Http -lt 500 })
$codigos409 = Codigos -Respuestas $r409
Write-Host "       respuestas: 200=$($ok.Count) 409=$($r409.Count) 5xx=$($r5xx.Count) otros=$($otros.Count) en $($rafaga.TotalMs) ms"

$despuesA = Leer-Item -CentroId $centroObj.id -ItemId $item.id -Headers $hAdmin
$finalEsperado = $stock - ($ok.Count * $k)
Paso "A  exactamente $esperados despachos aceptados (200)" ($ok.Count -eq $esperados) "aceptados=$($ok.Count)"
Paso "A  $($Despachos - $esperados) rechazos 409 STOCK_INSUFICIENTE" `
    (($r409.Count -eq ($Despachos - $esperados)) -and (@($codigos409 | Where-Object { $_ -ne 'STOCK_INSUFICIENTE' }).Count -eq 0)) `
    "409=$($r409.Count) codigos distintos de STOCK_INSUFICIENTE: $(@($codigos409 | Where-Object { $_ -ne 'STOCK_INSUFICIENTE' }).Count)"
Paso 'A  ningun 500' ($r5xx.Count -eq 0) "5xx=$($r5xx.Count)"
Paso 'A  stock final = stock - aceptados x k, nunca negativo' `
    (($despuesA.disponible -eq $finalEsperado) -and ($despuesA.disponible -ge 0)) `
    "inicial=$stock  aceptados=$($ok.Count) x $k  final=$($despuesA.disponible) (esperado $finalEsperado)"

# --- 4. Fase B: donaciones simultaneas ------------------------------------------
$falta = [int]($despuesA.requerido - $despuesA.disponible)
Write-Host ''
if ($falta -lt 1) {
    Write-Host '--- Fase B: no falta nada que donar; se omite ---'
} else {
    $mitadB = [Math]::Max(1, [Math]::Floor($Donaciones / 2))
    $d = [int][Math]::Max(1, [Math]::Ceiling($falta / $mitadB))
    $aceptadasEsperadas = [int][Math]::Min($Donaciones, [Math]::Ceiling($falta / $d))
    Write-Host "--- Fase B: $Donaciones donaciones simultaneas de $d unidades (falta $falta, ofrecido $($Donaciones * $d)) ---"

    $peticiones = @()
    for ($n = 0; $n -lt $Donaciones; $n++) {
        $peticiones += [pscustomobject]@{ Token = $tokensDonantes[$n % $tokensDonantes.Count]; Cuerpo = @{ itemId = $item.id; cantidad = $d } }
    }
    $rafagaB = Disparar-Rafaga -Ruta "/centros-acopio/$($centroObj.id)/inventario/donacion" -Peticiones $peticiones

    $okB = @($rafagaB.Resultados | Where-Object { $_.Http -eq 200 })
    $r409B = @($rafagaB.Resultados | Where-Object { $_.Http -eq 409 })
    $r5xxB = @($rafagaB.Resultados | Where-Object { $_.Http -ge 500 })
    $codigosB = Codigos -Respuestas $r409B
    $sumaAceptada = 0
    foreach ($r in $okB) { $sumaAceptada += [int]$r.Json.cantidadAceptada }
    Write-Host "       respuestas: 200=$($okB.Count) 409=$($r409B.Count) 5xx=$($r5xxB.Count) en $($rafagaB.TotalMs) ms"

    $despuesB = Leer-Item -CentroId $centroObj.id -ItemId $item.id -Headers $hAdmin
    Paso 'B  la suma aceptada es exactamente lo que faltaba' ($sumaAceptada -eq $falta) `
        "faltaba=$falta  aceptado=$sumaAceptada  ofrecido=$($Donaciones * $d)"
    Paso "B  $aceptadasEsperadas donaciones aceptadas, el resto 409 NECESIDAD_CUBIERTA" `
        (($okB.Count -eq $aceptadasEsperadas) -and ($r409B.Count -eq ($Donaciones - $aceptadasEsperadas)) -and `
         (@($codigosB | Where-Object { $_ -ne 'NECESIDAD_CUBIERTA' }).Count -eq 0)) `
        "aceptadas=$($okB.Count) rechazadas=$($r409B.Count)"
    Paso 'B  ningun 500' ($r5xxB.Count -eq 0) "5xx=$($r5xxB.Count)"
    Paso 'B  el insumo queda completo (disponible = requerido)' ($despuesB.disponible -eq $despuesB.requerido) `
        "disponible=$($despuesB.disponible) requerido=$($despuesB.requerido)"
}

Write-Host ''
if ($script:fallos -eq 0) {
    Write-Host 'RESULTADO: TODOS LOS PASOS PASARON' -ForegroundColor Green
    exit 0
} else {
    Write-Host "RESULTADO: $($script:fallos) paso(s) FALLARON" -ForegroundColor Red
    exit 1
}
