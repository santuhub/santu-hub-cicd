#!/bin/bash

# Script pour construire et publier l'image Docker de santu-hub-cicd-example

# *************************** VARIABLES  ****************************
# Définir les variables
IMAGE_NAME="santu-hub-cicd"
REGISTRY="ghcr.io"
REPO="aboubacar3012/santu-hub-cicd-example"
# Format de date JJ-MM-AA-HH-MM
DATE_FORMAT=$(LC_TIME=fr_FR.UTF-8 TZ=Europe/Paris date +"%a_%d_%B_%Y_%Hh%M")

# *************************** GESTION VERSION ****************************
# Obtenir l'auteur du dernier commit si disponible
if [ -z "$GITHUB_ACTIONS" ]; then
  # Exécution locale
  COMMIT_AUTHOR=$(git log -1 --pretty=format:"%an" 2>/dev/null || echo "local")
  # Nettoyer le nom de l'auteur pour qu'il soit compatible avec les tags Docker (pas d'espaces)
  COMMIT_AUTHOR=$(echo "$COMMIT_AUTHOR" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
else
  # Dans GitHub Actions, utiliser l'acteur de l'événement
  COMMIT_AUTHOR=$GITHUB_ACTOR
fi

# Vérifier si nous sommes dans une Pull Request dans GitHub Actions
if [ -n "$GITHUB_ACTIONS" ] && [ -n "$GITHUB_HEAD_REF" ]; then
  # Nous sommes dans une PR
  # Extraire le numéro de PR
  PR_NUMBER=$(echo $GITHUB_REF | sed -n 's/refs\/pull\/\([0-9]*\)\/merge/\1/p')
  if [ -n "$PR_NUMBER" ]; then
    # Récupérer le titre de la PR via GitHub API
    PR_TITLE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
               "https://api.github.com/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" | \
               jq -r .title)
    
    # Nettoyer le titre pour qu'il soit utilisable comme tag Docker
    PR_TAG=$(echo "pr-$PR_NUMBER-${PR_TITLE}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-_.' | cut -c 1-128)
    
    # Créer le tag avec la date et l'auteur
    TAG="${COMMIT_AUTHOR}-${DATE_FORMAT}-${PR_TAG}"
    echo "Pull Request détectée. Utilisation du tag: $TAG"
  else
    # Fallback si nous ne pouvons pas extraire le numéro de PR
    PR_BRANCH=$(echo $GITHUB_HEAD_REF | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-_.')
    TAG="${COMMIT_AUTHOR}-${DATE_FORMAT}-pr-${PR_BRANCH}"
  fi
else
  # Nous ne sommes pas dans une PR, utiliser la date et l'auteur
  TAG="${COMMIT_AUTHOR}-${DATE_FORMAT}"
  echo "Utilisation de la date et de l'auteur comme tag: $TAG"
fi

echo "Construction de l'image santu-hub-cicd avec le tag: $TAG"

# *************************** ENVIRONNEMENT ****************************
# Définir la racine du projet
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
# Charger les variables d'environnement à partir du fichier .env à la racine du projet
if [ -f "$PROJECT_ROOT/.env" ]; then
  echo "Chargement des variables d'environnement depuis $PROJECT_ROOT/.env"
  
  # Charger toutes les variables d'environnement en excluant les commentaires
  set -a
  source <(grep -v '^#' "$PROJECT_ROOT/.env" | grep -v '^$' | sed 's/\r$//')
  set +a
else
  echo "Fichier .env non trouvé à la racine du projet. La publication nécessite PAT_GITHUB_TOKEN."
fi

# *************************** CONSTRUCTION DOCKER ****************************
# Construire l'image
echo "Construction de l'image Docker santu-hub-cicd..."

# Se placer dans le répertoire du projet avant la construction
cd "$PROJECT_ROOT" || { echo "Erreur: Impossible d'accéder au répertoire $PROJECT_ROOT"; exit 1; }
echo "Répertoire de construction: $(pwd)"

# Construire l'image
docker build --platform=linux/amd64 -t "${IMAGE_NAME}:${TAG}" .

# Vérifier si la construction a réussi
if [ $? -ne 0 ]; then
  echo "Échec de la construction de l'image Docker santu-hub-cicd."
  exit 1
fi

echo "Image Docker santu-hub-cicd construite avec succès: ${IMAGE_NAME}:${TAG}"

# *************************** PUBLICATION ****************************
# Demander à l'utilisateur s'il souhaite publier l'image sur GitHub Container Registry
read -p "Voulez-vous publier l'image sur GitHub Container Registry? (y/n): " PUSH_IMAGE
if [[ $PUSH_IMAGE == "y" || $PUSH_IMAGE == "Y" ]]; then
  # Vérification GitHub Actions vs exécution locale
  if [ -n "$GITHUB_ACTIONS" ]; then
    echo "Exécution dans GitHub Actions, l'authentification sera faite avec GITHUB_TOKEN..."
  else
    # En environnement local, vérifier si le PAT_GITHUB_TOKEN est disponible dans les variables d'environnement
    if [ -z "$PAT_GITHUB_TOKEN" ]; then
      echo "PAT_GITHUB_TOKEN non trouvé dans le fichier .env. Publication impossible."
      exit 1
    fi

    # Connexion à GitHub Container Registry localement
    echo "Connexion à GitHub Container Registry avec le token PAT depuis .env..."
    echo $PAT_GITHUB_TOKEN | docker login ${REGISTRY} -u aboubacar3012 --password-stdin
  fi

  # Tag de l'image avec la date
  echo "Tag de l'image pour GitHub Container Registry..."
  docker tag ${IMAGE_NAME}:${TAG} ${REGISTRY}/${REPO}:${TAG}
  
  # Tag de l'image comme "latest"
  echo "Tag de l'image comme 'latest'..."
  docker tag ${IMAGE_NAME}:${TAG} ${REGISTRY}/${REPO}:latest

  # Publication de l'image avec la date
  echo "Publication de l'image sur GitHub Container Registry..."
  docker push ${REGISTRY}/${REPO}:${TAG}
  
  # Publication de l'image avec le tag "latest"
  echo "Publication de l'image avec le tag 'latest'..."
  docker push ${REGISTRY}/${REPO}:latest

  echo "Images publiées avec succès: ${REGISTRY}/${REPO}:${TAG} et ${REGISTRY}/${REPO}:latest"
fi

echo "Script terminé avec succès."