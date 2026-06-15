#Requires -Version 7.0
<#
.SYNOPSIS
    Installe le serveur MCP Azure DevOps depuis un dossier réseau.

.DESCRIPTION
    Ce script installe le package @azure-devops/mcp depuis un dossier réseau
    et génère les configurations JSON pour Claude Code, Claude Desktop et OpenCode.

.PARAMETER NetworkFolder
    Chemin vers le dossier réseau contenant le package (.tgz).
    Ex: \\serveur\partage\mcp  ou  Z:\outils\mcp

.PARAMETER Organization
    Nom de l'organisation Azure DevOps (ex: contoso).
    Si absent, le script demande interactivement.

.PARAMETER AuthType
    Type d'authentification: interactive, azcli, envvar, pat.
    Par défaut: interactive.

.PARAMETER ServerUrl
    URL personnalisée pour Azure DevOps Server (on-premises).
    Ex: https://tfs.contoso.com/tfs/DefaultCollection
    Si absent, utilise https://dev.azure.com/<organisation>

.PARAMETER Force
    Réinstalle même si la version est déjà installée.

.EXAMPLE
    .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\serveur\partage\mcp"
    Installation minimale : le script demande interactivement l'organisation, le type de déploiement et le PAT.

.EXAMPLE
    .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\serveur\partage\mcp" -Organization "contoso"
    Pré-renseigne l'organisation ; le script demande le reste.

.EXAMPLE
    .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "Z:\outils\mcp" -Organization "contoso" -AuthType "pat"
    Azure DevOps Services (cloud) avec PAT : le script demande le token interactivement et génère les configs JSON avec la valeur encodée.

.EXAMPLE
    .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "Z:\outils\mcp" -Organization "DefaultCollection" -AuthType "pat" -ServerUrl "https://tfs.contoso.com/tfs/DefaultCollection"
    Azure DevOps Server (on-premises / TFS) avec PAT.

.EXAMPLE
    .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "Z:\outils\mcp" -Organization "contoso" -AuthType "azcli"
    Authentification via Azure CLI (az login), sans saisie de token.

.EXAMPLE
    .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\serveur\partage\mcp" -Organization "contoso" -AuthType "pat" -Force
    Réinstalle le package même si la version est déjà présente.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Chemin vers le dossier réseau contenant le package .tgz")]
    [string]$NetworkFolder,

    [Parameter(Mandatory = $false)]
    [string]$Organization,

    [Parameter(Mandatory = $false)]
    [ValidateSet("interactive", "azcli", "envvar", "pat")]
    [string]$AuthType = "pat",

    [Parameter(Mandatory = $false)]
    [string]$ServerUrl,

    [Parameter(Mandatory = $false)]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ─── Helpers ─────────────────────────────────────────────────────────────────

function Write-Header {
    param([string]$Text)
    $line = "─" * 60
    Write-Host ""
    Write-Host $line -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host $line -ForegroundColor Cyan
}

function Write-Step {
    param([string]$Text)
    Write-Host "  ► $Text" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Text)
    Write-Host "  ✓ $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "  ⚠ $Text" -ForegroundColor DarkYellow
}

function Write-Fail {
    param([string]$Text)
    Write-Host "  ✗ $Text" -ForegroundColor Red
}

function Write-JsonBlock {
    param([string]$Title, [string]$Json, [string]$Path = "")
    Write-Host ""
    Write-Host "  ┌─ $Title" -ForegroundColor Magenta
    if ($Path) {
        Write-Host "  │  Fichier : $Path" -ForegroundColor DarkGray
    }
    Write-Host ""
    $Json -split "`n" | ForEach-Object { Write-Host "  │  $_" -ForegroundColor White }
    Write-Host ""
}

function Prompt-Input {
    param([string]$Prompt, [string]$Default = "")
    $hint = if ($Default) { " [$Default]" } else { "" }
    $value = Read-Host "  ? $Prompt$hint"
    if ([string]::IsNullOrWhiteSpace($value) -and $Default) { return $Default }
    return $value.Trim()
}

function Prompt-Choice {
    param([string]$Prompt, [string[]]$Choices, [string]$Default)
    $numbered = $Choices | ForEach-Object -Begin { $i = 1 } -Process { "  $i) $_"; $i++ }
    Write-Host ""
    Write-Host "  ? $Prompt" -ForegroundColor Yellow
    $numbered | ForEach-Object { Write-Host $_ }
    $defaultIdx = ([array]::IndexOf($Choices, $Default)) + 1
    $raw = Read-Host "  Choix [$defaultIdx]"
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $idx = [int]$raw - 1
    if ($idx -lt 0 -or $idx -ge $Choices.Count) { return $Default }
    return $Choices[$idx]
}

# ─── Banner ───────────────────────────────────────────────────────────────────

Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        Azure DevOps MCP Server — Installation           ║" -ForegroundColor Cyan
Write-Host "  ║               Déploiement depuis dossier réseau         ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ─── 1. Prérequis ─────────────────────────────────────────────────────────────

Write-Header "1/4 · Vérification des prérequis"

Write-Step "Vérification de Node.js..."
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Node.js introuvable" }
    $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($major -lt 20) {
        Write-Fail "Node.js $nodeVersion détecté — version 20+ requise."
        Write-Host "  Téléchargez Node.js 20+ sur https://nodejs.org" -ForegroundColor DarkGray
        exit 1
    }
    Write-Ok "Node.js $nodeVersion"
} catch {
    Write-Fail "Node.js n'est pas installé ou introuvable dans le PATH."
    Write-Host "  Téléchargez Node.js 20+ sur https://nodejs.org" -ForegroundColor DarkGray
    exit 1
}

Write-Step "Vérification de npm..."
try {
    $npmVersion = npm --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "npm introuvable" }
    Write-Ok "npm $npmVersion"
} catch {
    Write-Fail "npm n'est pas disponible. Réinstallez Node.js."
    exit 1
}

# ─── 2. Localisation du package ──────────────────────────────────────────────

Write-Header "2/4 · Localisation du package"

Write-Step "Recherche dans : $NetworkFolder"

if (-not (Test-Path $NetworkFolder)) {
    Write-Fail "Dossier inaccessible : $NetworkFolder"
    Write-Host "  Vérifiez le chemin réseau et vos droits d'accès." -ForegroundColor DarkGray
    exit 1
}

$tgzFiles = Get-ChildItem -Path $NetworkFolder -Filter "*.tgz" | Sort-Object LastWriteTime -Descending

if ($tgzFiles.Count -eq 0) {
    Write-Fail "Aucun fichier .tgz trouvé dans $NetworkFolder"
    Write-Host "  Demandez à votre administrateur de déposer le package dans ce dossier." -ForegroundColor DarkGray
    exit 1
}

$packageFile = $tgzFiles[0]

if ($tgzFiles.Count -gt 1) {
    Write-Warn "$($tgzFiles.Count) packages trouvés — utilisation du plus récent :"
} else {
    Write-Ok "Package trouvé :"
}
Write-Host "     $($packageFile.Name)  ($([math]::Round($packageFile.Length / 1KB, 1)) Ko)" -ForegroundColor White
Write-Host "     Modifié le : $($packageFile.LastWriteTime.ToString('dd/MM/yyyy HH:mm'))" -ForegroundColor DarkGray

# Lire la version depuis le nom du fichier (azure-devops-mcp-X.Y.Z.tgz)
$packageVersion = if ($packageFile.Name -match '\-(\d+\.\d+\.\d+)\.tgz$') { $Matches[1] } else { "?" }

# ─── 3. Installation ──────────────────────────────────────────────────────────

Write-Header "3/4 · Installation du package"

# Vérifier si déjà installé
$alreadyInstalled = $false
try {
    $installedVersion = (npm list -g --depth=0 --json 2>$null | ConvertFrom-Json).dependencies.'@azure-devops/mcp'.version
    if ($installedVersion) {
        if ($installedVersion -eq $packageVersion -and -not $Force) {
            Write-Ok "Version $installedVersion déjà installée (utilisez -Force pour réinstaller)"
            $alreadyInstalled = $true
        } else {
            Write-Warn "Version installée : $installedVersion → mise à jour vers $packageVersion"
        }
    }
} catch {
    # Pas encore installé — normal
}

if (-not $alreadyInstalled) {
    Write-Step "Installation de $($packageFile.Name)..."
    Write-Host "  (les dépendances npm seront téléchargées depuis internet)" -ForegroundColor DarkGray
    Write-Host ""

    $installResult = npm install -g $packageFile.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Échec de l'installation npm :"
        $installResult | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
        exit 1
    }

    # Vérifier que le binaire est accessible
    $binaryPath = (Get-Command mcp-server-azuredevops -ErrorAction SilentlyContinue)?.Source
    if (-not $binaryPath) {
        Write-Warn "Le binaire 'mcp-server-azuredevops' n'est pas dans le PATH."
        Write-Host "  Redémarrez votre terminal ou relancez PowerShell." -ForegroundColor DarkGray
    } else {
        Write-Ok "Installé : $binaryPath"
    }
}

# ─── 4. Configuration ─────────────────────────────────────────────────────────

Write-Header "4/4 · Configuration du serveur MCP"

# Organisation
if ([string]::IsNullOrWhiteSpace($Organization)) {
    $Organization = Prompt-Input "Nom de l'organisation Azure DevOps (ex: contoso)"
    while ([string]::IsNullOrWhiteSpace($Organization)) {
        Write-Warn "L'organisation est obligatoire."
        $Organization = Prompt-Input "Nom de l'organisation Azure DevOps"
    }
}
Write-Ok "Organisation : $Organization"

# Azure DevOps Server (on-premises) ?
if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    $isOnPrem = (Prompt-Choice "Type de déploiement Azure DevOps ?" `
        @("Azure DevOps Services (cloud — dev.azure.com)", "Azure DevOps Server (on-premises / TFS)") `
        "Azure DevOps Services (cloud — dev.azure.com)") -eq "Azure DevOps Server (on-premises / TFS)"

    if ($isOnPrem) {
        $ServerUrl = Prompt-Input "URL du serveur Azure DevOps Server (ex: https://tfs.contoso.com/tfs/DefaultCollection)"
        while ([string]::IsNullOrWhiteSpace($ServerUrl)) {
            Write-Warn "L'URL est obligatoire pour Azure DevOps Server."
            $ServerUrl = Prompt-Input "URL du serveur"
        }
        Write-Ok "Serveur : $ServerUrl"
    }
} else {
    Write-Ok "Serveur : $ServerUrl"
}

# Mode d'authentification
if ($PSBoundParameters.ContainsKey('AuthType') -eq $false) {
    $AuthType = Prompt-Choice "Mode d'authentification ?" `
        @("interactive (navigateur Microsoft)", "azcli (az login)", "envvar (ADO_MCP_AUTH_TOKEN)", "pat (Personal Access Token)") `
        "pat (Personal Access Token)"
    $AuthType = $AuthType -replace " .*$", ""  # Extraire seulement le mot-clé
}
Write-Ok "Authentification : $AuthType"

# PAT : afficher les instructions
$patEnvNote = ""
$envvarNote = ""

if ($AuthType -eq "pat") {
    Write-Host ""
    Write-Host "  ── Saisie du PAT ──────────────────────────────────────────" -ForegroundColor DarkYellow
    Write-Host "  Créez un PAT dans Azure DevOps : Paramètres utilisateur → Personal Access Tokens" -ForegroundColor DarkGray
    $patRaw = Read-Host "  ? Personal Access Token" -AsSecureString
    $patPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($patRaw)
    )
    $patBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("user:$patPlain"))
    Write-Ok "PAT encodé en base64"
    Write-Host "  ───────────────────────────────────────────────────────────" -ForegroundColor DarkYellow
    $patEnvNote = ",`n      `"env`": {`n        `"PERSONAL_ACCESS_TOKEN`": `"$patBase64`"`n      }"
} elseif ($AuthType -eq "envvar") {
    Write-Host ""
    Write-Host "  ── Instructions envvar ────────────────────────────────────" -ForegroundColor DarkYellow
    Write-Host '  Définissez la variable d''environnement ADO_MCP_AUTH_TOKEN avec votre token bearer.' -ForegroundColor DarkYellow
    Write-Host "  ───────────────────────────────────────────────────────────" -ForegroundColor DarkYellow
    $envvarNote = '
      "env": {
        "ADO_MCP_AUTH_TOKEN": "<votre-token-bearer>"
      }'
}

# ─── Génération des arguments ─────────────────────────────────────────────────

$baseArgs = @($Organization)
if ($AuthType -ne "interactive") {
    $baseArgs += @("--authentication", $AuthType)
}
if (-not [string]::IsNullOrWhiteSpace($ServerUrl)) {
    $baseArgs += @("--url", $ServerUrl)
}

$argsJsonArray = ($baseArgs | ForEach-Object { "`"$_`"" }) -join ", "
$argsCliString = $baseArgs -join " "

# ─── Configurations JSON ──────────────────────────────────────────────────────

Write-Header "Configurations JSON à copier dans votre LLM"

# ── Claude Code ───────────────────────────────────────────────────────────────

$claudeCodeCmd = "claude mcp add azure-devops -- mcp-server-azuredevops $argsCliString"

Write-Host ""
Write-Host "  ┌─ Claude Code (CLI)" -ForegroundColor Magenta
Write-Host "  │  Exécutez cette commande dans votre terminal :" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  │  $claudeCodeCmd" -ForegroundColor White
Write-Host ""

# ── Claude Desktop ────────────────────────────────────────────────────────────

$claudeDesktopPath = if ($IsWindows) {
    "$env:APPDATA\Claude\claude_desktop_config.json"
} elseif ($IsMacOS) {
    "~/Library/Application Support/Claude/claude_desktop_config.json"
} else {
    "~/.config/claude/claude_desktop_config.json"
}

$envBlock = if ($patEnvNote) { $patEnvNote } elseif ($envvarNote) { $envvarNote } else { "" }

$claudeDesktopJson = @"
{
  "mcpServers": {
    "azure-devops": {
      "command": "mcp-server-azuredevops",
      "args": [$argsJsonArray]$envBlock
    }
  }
}
"@

Write-JsonBlock "Claude Desktop" $claudeDesktopJson $claudeDesktopPath

# ── OpenCode ──────────────────────────────────────────────────────────────────

$openCodePath = if ($IsWindows) {
    "$env:APPDATA\opencode\opencode.json"
} else {
    "~/.config/opencode/opencode.json"
}

$openCodeArgs = @("mcp-server-azuredevops") + $baseArgs
$openCodeArgsJson = ($openCodeArgs | ForEach-Object { "`"$_`"" }) -join ", "

$openCodeEnvBlock = ""
if ($AuthType -eq "pat") {
    $openCodeEnvBlock = @"
,
      "env": {
        "PERSONAL_ACCESS_TOKEN": "$patBase64"
      }
"@
} elseif ($AuthType -eq "envvar") {
    $openCodeEnvBlock = @"
,
      "env": {
        "ADO_MCP_AUTH_TOKEN": "<votre-token-bearer>"
      }
"@
}

$openCodeJson = @"
{
  "`$schema": "https://opencode.ai/config.json",
  "mcp": {
    "azure-devops": {
      "type": "local",
      "command": [$openCodeArgsJson],
      "enabled": true$openCodeEnvBlock
    }
  }
}
"@

Write-JsonBlock "OpenCode" $openCodeJson $openCodePath

# ── VS Code / Cursor / Kilocode (.vscode/mcp.json) ───────────────────────────

$vscodeJson = @"
{
  "servers": {
    "azure-devops": {
      "type": "stdio",
      "command": "mcp-server-azuredevops",
      "args": [$argsJsonArray]$envBlock
    }
  }
}
"@

Write-JsonBlock "VS Code / Cursor / Kilocode (.vscode/mcp.json)" $vscodeJson

# ─── Résumé final ─────────────────────────────────────────────────────────────

$line = "─" * 60
Write-Host $line -ForegroundColor Green
Write-Host "  Installation terminée avec succès !" -ForegroundColor Green
Write-Host ""
Write-Host "  Package  : @azure-devops/mcp v$packageVersion" -ForegroundColor White
Write-Host "  Org      : $Organization" -ForegroundColor White
if (-not [string]::IsNullOrWhiteSpace($ServerUrl)) {
    Write-Host "  Serveur  : $ServerUrl" -ForegroundColor White
}
Write-Host "  Auth     : $AuthType" -ForegroundColor White
Write-Host ""
Write-Host "  Copiez le bloc JSON correspondant à votre LLM et redémarrez-le." -ForegroundColor DarkGray
Write-Host $line -ForegroundColor Green
Write-Host ""
