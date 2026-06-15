# Installation du serveur MCP Azure DevOps

## Prérequis

- [PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)
- [Node.js 20+](https://nodejs.org)
- Le package `.tgz` disponible dans un dossier accessible

---

## 1. Télécharger et lancer le script

### PowerShell (recommandé sur Windows)

```powershell
iwr https://raw.githubusercontent.com/RobinToubi/azure-devops-mcp/main/scripts/Install-AzureDevOpsMCP.ps1 -OutFile Install-AzureDevOpsMCP.ps1
pwsh -ExecutionPolicy Bypass -File .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\serveur\partage\mcp"
```

### curl

```powershell
curl -o Install-AzureDevOpsMCP.ps1 https://raw.githubusercontent.com/RobinToubi/azure-devops-mcp/main/scripts/Install-AzureDevOpsMCP.ps1
pwsh -ExecutionPolicy Bypass -File .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\serveur\partage\mcp"
```

### wget

```powershell
wget https://raw.githubusercontent.com/RobinToubi/azure-devops-mcp/main/scripts/Install-AzureDevOpsMCP.ps1
pwsh -ExecutionPolicy Bypass -File .\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\serveur\partage\mcp"
```

---

## 2. Ce que fait le script

1. Vérifie les prérequis (Node.js 20+, npm)
2. Détecte automatiquement le package `.tgz` le plus récent dans le dossier spécifié
3. Installe `@azure-devops/mcp` globalement via npm
4. Demande interactivement : organisation, type de déploiement (cloud / on-premises), PAT
5. Génère les blocs de configuration JSON prêts à coller pour **Claude Code**, **Claude Desktop**, **VS Code / Cursor** et **OpenCode**

---

## 3. Paramètres disponibles

| Paramètre        | Description                                     | Obligatoire             |
| ---------------- | ----------------------------------------------- | ----------------------- |
| `-NetworkFolder` | Chemin vers le dossier contenant le `.tgz`      | Oui                     |
| `-Organization`  | Nom de l'organisation Azure DevOps              | Non (demandé si absent) |
| `-AuthType`      | `pat` · `interactive` · `azcli` · `envvar`      | Non (défaut : `pat`)    |
| `-ServerUrl`     | URL Azure DevOps Server (on-premises)           | Non (demandé si absent) |
| `-Force`         | Réinstalle même si la version est déjà présente | Non                     |

---

## Exemples

```powershell
# Azure DevOps Services (cloud), PAT demandé interactivement
.\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\srv\partage\mcp" -Organization "contoso"

# Azure DevOps Server (on-premises)
.\Install-AzureDevOpsMCP.ps1 -NetworkFolder "Z:\outils\mcp" -Organization "DefaultCollection" -ServerUrl "https://tfs.contoso.com/tfs/DefaultCollection"

# Authentification via Azure CLI
.\Install-AzureDevOpsMCP.ps1 -NetworkFolder "Z:\outils\mcp" -Organization "contoso" -AuthType "azcli"

# Réinstaller une version déjà présente
.\Install-AzureDevOpsMCP.ps1 -NetworkFolder "\\srv\partage\mcp" -Organization "contoso" -Force
```
