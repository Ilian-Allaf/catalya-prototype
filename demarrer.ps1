$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode=(Get-Command node -ErrorAction SilentlyContinue).Source
if(-not $taskNode -or [int]((& $taskNode --version).TrimStart('v').Split('.')[0]) -lt 22){
 $taskBundled=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 if(Test-Path -LiteralPath $taskBundled){$taskNode=$taskBundled}else{throw 'Installer Node.js 22.13 ou supérieur, puis relancer ce script.'}
}
if(-not(Test-Path -LiteralPath 'node_modules/next/dist/bin/next')){
 $taskNpm=(Get-Command npm -ErrorAction Stop).Source
 $taskNpmCli=Join-Path (Split-Path $taskNpm) 'node_modules/npm/bin/npm-cli.js'
 if(-not(Test-Path -LiteralPath $taskNpmCli)){throw 'npm est introuvable. Installer Node.js avec npm.'}
 & $taskNode $taskNpmCli ci
 if($LASTEXITCODE -ne 0){throw 'Installation des dépendances échouée.'}
}
& $taskNode node_modules/next/dist/bin/next build --webpack
if($LASTEXITCODE -ne 0){throw 'Compilation échouée.'}
Write-Host 'Catalya Next.js : http://127.0.0.1:3000 — Ctrl+C pour arrêter.'
& $taskNode node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
