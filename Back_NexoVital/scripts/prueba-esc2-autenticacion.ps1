<#
.SYNOPSIS
Prueba EN VIVO del escenario de calidad ESC-2 (autenticación de actores).

.DESCRIPTION
Ejercita los cuatro vectores del escenario contra un backend REAL en ejecución:

  1. Login legítimo                         -> 200 + token
  2. Token válido                           -> 200
  3. Sin token                              -> 401 NO_AUTENTICADO
  4. Token con formato inválido             -> 401
  5. Token alterado (firma cambiada)        -> 401
  6. Token expirado                         -> 401
  7. Token firmado con otro secreto         -> 401
  8. 100 peticiones legítimas               -> 100/100 (0 falsos rechazos)

Los vectores 6 y 7 necesitan que el backend se haya levantado con un secreto
conocido, para que este script pueda firmar tokens con ese mismo secreto:

  $env:NEXOVITAL_AUTH_LOCAL_ENABLED = "true"
  $env:NEXOVITAL_JWT_SECRET = "secreto-local-de-al-menos-32-bytes-0123456789"
  .\mvnw.cmd spring-boot:run

y luego:

  powershell -ExecutionPolicy Bypass -File scripts\prueba-esc2-autenticacion.ps1 `
      -Secret "secreto-local-de-al-menos-32-bytes-0123456789"

Sin -Secret se ejecutan los vectores 1 a 5 y los otros dos se reportan como
OMITIDOS (no como aprobados).

El login propio solo responde cuando `nexovital.auth.local.enabled=true`. Si
el backend arrancó sin esa variable, `POST /api/v1/sesiones` devuelve 404 y el
script lo dice: no es un fallo de autenticación, es el producto apagado.

.PARAMETER Base
Raíz de la API. Por defecto el backend local.

.PARAMETER Email
Usuario sembrado. Por defecto el conductor de demo.

.PARAMETER Password
Contraseña del usuario.

.PARAMETER Secret
Secreto HS256 con el que se levantó el backend. Habilita los vectores 6 y 7.

.PARAMETER Repeticiones
Cuántas peticiones legítimas se hacen para medir falsos rechazos. Por defecto 100.

.PARAMETER SinLegitimas
Omite el bloque de 100 peticiones (útil para una corrida rápida).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\prueba-esc2-autenticacion.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\prueba-esc2-autenticacion.ps1 `
    -Secret "secreto-local-de-al-menos-32-bytes-0123456789" -Repeticiones 100
#>
param(
    [string]$Base = 'http://localhost:8080',
    [string]$Email = 'conductor1@nexovital.co',
    [string]$Password = 'conductor123',
    [string]$Secret = '',
    [int]$Repeticiones = 100,
    [switch]$SinLegitimas
)

$ErrorActionPreference = 'Stop'
$script:fallos = 0

function Paso {
    param([string]$Nombre, [bool]$Ok, [string]$Detalle = '')
    $marca = if ($Ok) { '[ OK ]' } else { '[FALLA]'; $script:fallos++ }
    Write-Host "$marca $Nombre"
    if ($Detalle) { Write-Host "       $Detalle" }
}

function Omitido {
    param([string]$Nombre, [string]$Motivo)
    Write-Host "[OMITIDO] $Nombre"
    Write-Host "          $Motivo"
}

# Lee el cuerpo de una respuesta de error. En PowerShell 5.1
# `ErrorDetails.Message` no lo expone: hay que leer el stream.
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

function Pedir {
    param([string]$Metodo, [string]$Ruta, [string]$Token, $Cuerpo)
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $parametros = @{
        Method         = $Metodo
        Uri            = "$Base$Ruta"
        Headers        = $headers
        UseBasicParsing = $true
        TimeoutSec     = 20
    }
    if ($null -ne $Cuerpo) {
        $parametros.ContentType = 'application/json'
        $parametros.Body = ($Cuerpo | ConvertTo-Json -Compress)
    }
    try {
        $r = Invoke-WebRequest @parametros
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = $r.Content }
    } catch {
        $respuesta = $_.Exception.Response
        $codigo = if ($respuesta) { [int]$respuesta.StatusCode } else { 0 }
        return [pscustomobject]@{ Status = $codigo; Body = (Leer-CuerpoDeError $_) }
    }
}

function ConvertTo-Base64Url {
    param([byte[]]$Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-JwtPayload {
    param([string]$Token)
    $parte = $Token.Split('.')[1]
    $parte = $parte.Replace('-', '+').Replace('_', '/')
    switch ($parte.Length % 4) {
        2 { $parte += '==' }
        3 { $parte += '=' }
    }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parte))
    return $json | ConvertFrom-Json
}

# Firma un JWT HS256 igual que JwtTokenAdapter: sub, iat, exp.
function New-Jwt {
    param(
        [string]$Secreto,
        [string]$Subject,
        [int]$ExpiraEnSegundos = 3600
    )
    $header = @{ alg = 'HS256'; typ = 'JWT' } | ConvertTo-Json -Compress
    $ahora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $payload = @{
        sub = $Subject
        iat = $ahora
        exp = ($ahora + $ExpiraEnSegundos)
    } | ConvertTo-Json -Compress

    $h = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($header))
    $p = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($payload))
    $baseFirma = "$h.$p"

    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secreto)
        $firma = ConvertTo-Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($baseFirma)))
    } finally {
        $hmac.Dispose()
    }
    return "$baseFirma.$firma"
}

Write-Host ''
Write-Host '================================================================='
Write-Host '  ESC-2 - Autenticacion de actores (prueba en vivo)'
Write-Host "  Base: $Base"
Write-Host '================================================================='

# ---------------------------------------------------------------- 0. salud
$salud = Pedir -Metodo 'GET' -Ruta '/actuator/health'
if ($salud.Status -ne 200) {
    Write-Host "[FALLA] El backend no responde en $Base (status $($salud.Status))."
    Write-Host '        Levantalo con:  $env:NEXOVITAL_AUTH_LOCAL_ENABLED="true"; .\mvnw.cmd spring-boot:run'
    exit 1
}
Paso 'Backend arriba' $true "GET /actuator/health -> $($salud.Status)"

# ---------------------------------------------------------------- 1. login
$login = Pedir -Metodo 'POST' -Ruta '/api/v1/sesiones' -Cuerpo @{
    email    = $Email
    password = $Password
}

if ($login.Status -eq 404) {
    Write-Host '[FALLA] POST /api/v1/sesiones responde 404: el login propio esta apagado.'
    Write-Host '        Es el comportamiento del producto. Para probar, arranca el backend con:'
    Write-Host '        $env:NEXOVITAL_AUTH_LOCAL_ENABLED = "true"'
    exit 1
}

$token = ''
if ($login.Status -eq 200) {
    $token = ($login.Body | ConvertFrom-Json).token
}
Paso 'Login legitimo devuelve 200 y un JWT' ($login.Status -eq 200 -and $token.Split('.').Count -eq 3) `
    "status $($login.Status), partes del token: $($token.Split('.').Count)"

if (-not $token) {
    Write-Host 'Sin token no se pueden ejecutar los demas vectores.'
    exit 1
}

$subject = (Get-JwtPayload $token).sub
Write-Host "       sub del token: $subject"

# ---------------------------------------------------------------- 2. valido
$valido = Pedir -Metodo 'GET' -Ruta '/api/v1/sesiones/actual' -Token $token
Paso 'Token valido devuelve 200' ($valido.Status -eq 200) "status $($valido.Status)"

# ---------------------------------------------------------------- 3. sin token
$sinToken = Pedir -Metodo 'GET' -Ruta '/api/v1/mapa'
$codigoSinToken = ''
try { $codigoSinToken = ($sinToken.Body | ConvertFrom-Json).codigo } catch { }
Paso 'Sin token devuelve 401 NO_AUTENTICADO' `
    ($sinToken.Status -eq 401 -and $codigoSinToken -eq 'NO_AUTENTICADO') `
    "status $($sinToken.Status), codigo '$codigoSinToken'"

# ---------------------------------------------------------------- 4. malformado
$malformado = Pedir -Metodo 'GET' -Ruta '/api/v1/sesiones/actual' -Token 'esto-no-es-un-jwt'
Paso 'Token con formato invalido devuelve 401' ($malformado.Status -eq 401) "status $($malformado.Status)"

# ---------------------------------------------------------------- 5. alterado
$alterado = $token.Substring(0, $token.Length - 1) + $(if ($token[-1] -eq 'A') { 'B' } else { 'A' })
$rAlterado = Pedir -Metodo 'GET' -Ruta '/api/v1/sesiones/actual' -Token $alterado
Paso 'Token alterado devuelve 401' ($rAlterado.Status -eq 401) "status $($rAlterado.Status)"

# ---------------------------------------------------------------- 6 y 7. secreto
if ($Secret) {
    if ([Text.Encoding]::UTF8.GetByteCount($Secret) -lt 32) {
        Write-Host '[FALLA] -Secret mide menos de 32 bytes: el backend habria abortado al arrancar.'
        $script:fallos++
    } else {
        $expirado = New-Jwt -Secreto $Secret -Subject $subject -ExpiraEnSegundos -60
        $rExpirado = Pedir -Metodo 'GET' -Ruta '/api/v1/sesiones/actual' -Token $expirado
        Paso 'Token expirado devuelve 401' ($rExpirado.Status -eq 401) "status $($rExpirado.Status)"

        $ajeno = New-Jwt -Secreto 'otro-emisor-con-un-secreto-distinto-0123456789' -Subject $subject
        $rAjeno = Pedir -Metodo 'GET' -Ruta '/api/v1/sesiones/actual' -Token $ajeno
        Paso 'Token firmado con otro secreto devuelve 401' ($rAjeno.Status -eq 401) "status $($rAjeno.Status)"
    }
} else {
    Omitido 'Token expirado' 'Pasa -Secret con el mismo NEXOVITAL_JWT_SECRET del backend.'
    Omitido 'Token firmado con otro secreto' 'Pasa -Secret con el mismo NEXOVITAL_JWT_SECRET del backend.'
}

# ---------------------------------------------------------------- 8. legítimas
if (-not $SinLegitimas) {
    $ok = 0
    for ($i = 1; $i -le $Repeticiones; $i++) {
        $r = Pedir -Metodo 'GET' -Ruta '/api/v1/sesiones/actual' -Token $token
        if ($r.Status -eq 200) { $ok++ }
    }
    Paso "Peticiones legitimas sin falsos rechazos ($ok/$Repeticiones)" `
        ($ok -eq $Repeticiones) "$ok/$Repeticiones respondieron 200"
}

# ---------------------------------------------------------------- resumen
Write-Host ''
if ($script:fallos -eq 0) {
    Write-Host 'RESULTADO: ESC-2 CUMPLE (0 fallos).'
    exit 0
}

Write-Host "RESULTADO: ESC-2 NO CUMPLE ($script:fallos fallo(s))."
exit 1
