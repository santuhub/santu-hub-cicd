#!/bin/bash
# ==============================================================================
# SCRIPT DE CRÉATION D'UTILISATEURS TEMPORAIRES : Création d'utilisateurs temporaires
#
# Ce script crée des utilisateurs temporaires avec une durée de vie de 2 heures.
# Les utilisateurs ont accès uniquement au root et au groupe docker.
#
# FONCTIONNALITÉS PRINCIPALES:
# ============================
# 1. Création d'utilisateurs avec mot de passe généré aléatoirement
# 2. Ajout au groupe docker
# 3. Programmation de la suppression automatique après 2 heures
# 4. Vérification des prérequis (root, groupe docker, at)
# 5. Affichage des informations de connexion
#
# CONDITIONS ET COMPORTEMENTS:
# ============================
# • PRÉREQUIS OBLIGATOIRES:
#   - Script exécuté en root (sudo ou root)
#   - Groupe docker existant
#   - Commande 'at' installée pour la programmation
#
# • UTILISATEURS CRÉÉS:
#   - Shell par défaut : /bin/bash
#   - Groupe secondaire : docker
#   - Durée de vie : 2 heures
#   - Mot de passe généré aléatoirement (12 caractères)
#
# • GESTION DES ERREURS:
#   - Arrêt immédiat en cas d'erreur critique (set -euo)
#   - Messages d'erreur clairs avec instructions
#
# PRÉREQUIS:
# ==========
# • Script exécuté en root (sudo ou root)
# • Groupe docker existant (Docker installé)
# • Commande 'at' installée (pour la programmation)
#
# Usage:
#   sudo ./createTempUsers.sh user1 user2 user3
#
# Exemples:
#   sudo ./createTempUsers.sh alice bob charlie
#
# Auteur : Inspiré de deploy.sh
# ==============================================================================

set -euo # Exit immediately on error, treat unset variables as error
set -o pipefail # Return pipeline status (status of last command to exit with non-zero)

DATE=$(date +"%Y%m%d-%H%M%S")

# ==============================================================================
# SECTION 1: COULEURS ET FONCTIONS DE LOGGING
# ==============================================================================

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Fonction pour logger avec timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Fonction pour logger les sections
log_section() {
    echo ""
    echo "============================================================"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "============================================================"
}

# Fonction pour afficher les messages
info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
    log "INFO: $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
    log "SUCCESS: $1"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    log "WARNING: $1"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    log "ERROR: $1"
    exit 1
}

# ==============================================================================
# SECTION 2: VÉRIFICATIONS PRÉALABLES
# ==============================================================================

# Vérifier que le script est exécuté en root
if [ "$EUID" -ne 0 ]; then 
    error "Ce script doit être exécuté avec sudo ou en tant que root"
fi

# Vérifier que le groupe docker existe
if ! getent group docker > /dev/null 2>&1; then
    error "Le groupe 'docker' n'existe pas. Veuillez installer Docker."
fi

# Vérifier que la commande 'at' est installée
if ! command -v at &> /dev/null; then
    error "La commande 'at' n'est pas installée. Installez-la avec : apt install at"
fi

# Vérifier que des utilisateurs sont fournis
if [ $# -eq 0 ]; then
    error "Aucun utilisateur fourni. Usage: $0 user1 user2 ..."
fi

# ==============================================================================
# SECTION 3: CONFIGURATION SSH
# ==============================================================================

SSH_PUBLIC_KEY_URL="https://raw.githubusercontent.com/aboubacar3012/santu-hub-cicd-example/main/public/sshPublicKey.txt"

# ==============================================================================
# SECTION 4: FONCTION POUR GÉNÉRER UN MOT DE PASSE
# ==============================================================================

generate_password() {
    # Générer un mot de passe aléatoire de 12 caractères
    openssl rand -base64 12 | tr -d "=+/" | cut -c1-12
}

# ==============================================================================
# SECTION 4: CRÉATION DES UTILISATEURS
# ==============================================================================

log_section "Création des utilisateurs temporaires"

USERS_CREATED=()

for USERNAME in "$@"; do
    info "Création de l'utilisateur temporaire : $USERNAME"
    
    # Vérifier si l'utilisateur existe déjà
    if id "$USERNAME" > /dev/null 2>&1; then
        warning "L'utilisateur $USERNAME existe déjà. Ignoré."
        continue
    fi
    
    # Générer un mot de passe
    PASSWORD=$(generate_password)
    
    # Créer l'utilisateur
    if useradd -m -s /bin/bash "$USERNAME"; then
        success "Utilisateur $USERNAME créé"
    else
        error "Échec de la création de l'utilisateur $USERNAME"
    fi
    
    # Définir le mot de passe
    echo "$USERNAME:$PASSWORD" | chpasswd
    
    # Ajouter au groupe docker
    if usermod -aG docker "$USERNAME"; then
        success "Utilisateur $USERNAME ajouté au groupe docker"
    else
        error "Échec de l'ajout de $USERNAME au groupe docker"
    fi
    
    # Configurer SSH
    USER_HOME=$(eval echo "~$USERNAME")
    SSH_DIR="$USER_HOME/.ssh"
    AUTHORIZED_KEYS="$SSH_DIR/authorized_keys"
    
    # Créer le répertoire .ssh
    mkdir -p "$SSH_DIR"
    chmod 700 "$SSH_DIR"
    chown "$USERNAME:$USERNAME" "$SSH_DIR"
    
    # Récupérer et ajouter la clé publique
    if curl -fsSL "$SSH_PUBLIC_KEY_URL" >> "$AUTHORIZED_KEYS"; then
        success "Clé SSH publique ajoutée pour $USERNAME"
    else
        error "Échec de la récupération de la clé SSH pour $USERNAME"
    fi
    
    chmod 600 "$AUTHORIZED_KEYS"
    chown "$USERNAME:$USERNAME" "$AUTHORIZED_KEYS"
    
    # Programmer la suppression après 2 heures
    if echo "userdel -r $USERNAME" | at now + 2 hours > /dev/null 2>&1; then
        success "Suppression programmée pour $USERNAME dans 2 heures"
    else
        warning "Échec de la programmation de la suppression pour $USERNAME"
    fi
    
    # Stocker les informations
    USERS_CREATED+=("$USERNAME:$PASSWORD")
    
    echo ""
done

# ==============================================================================
# SECTION 5: RÉSUMÉ FINAL
# ==============================================================================

log_section "Utilisateurs temporaires créés"
echo ""
success "Création terminée avec succès!"
echo ""

info "Résumé des utilisateurs créés:"
for USER_INFO in "${USERS_CREATED[@]}"; do
    USERNAME=$(echo "$USER_INFO" | cut -d: -f1)
    PASSWORD=$(echo "$USER_INFO" | cut -d: -f2)
    echo "  • Utilisateur: $USERNAME"
    echo "    Mot de passe: $PASSWORD"
    echo "    Groupes: docker"
    echo "    Clé SSH: configurée"
    echo "    Expiration: 2 heures"
    echo ""
done

info "Commandes utiles:"
echo "  • Lister les utilisateurs:"
echo "    cat /etc/passwd | grep -E '($(echo "$@" | tr ' ' '|'))'"
echo ""
echo "  • Vérifier les tâches programmées:"
echo "    atq"
echo ""
echo "  • Supprimer manuellement un utilisateur:"
echo "    userdel -r username"
echo ""

warning "Les utilisateurs seront automatiquement supprimés après 2 heures."
warning "Conservez les mots de passe en lieu sûr!"

log "Création terminée avec succès"
log "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
