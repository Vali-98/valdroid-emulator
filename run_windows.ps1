$ErrorActionPreference = "Stop"

$toolchain = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { "C:\msys64" }
if (-not $env:CC) {
    $env:CC = Join-Path $toolchain "ucrt64\bin\gcc.exe"
}
if (-not $env:CXX) {
    $env:CXX = Join-Path $toolchain "ucrt64\bin\g++.exe"
}
if (-not (Test-Path $env:CC) -or -not (Test-Path $env:CXX)) {
    throw "Install the MSYS2 UCRT64 MinGW-w64 GCC/G++ toolchain, or set CC and CXX."
}

$env:CGO_ENABLED = "1"
go run .