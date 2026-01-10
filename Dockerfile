# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Installation de pnpm
RUN npm install -g pnpm@8.6.7

# Copier les fichiers de dépendances
COPY package.json pnpm-lock.yaml ./

# Installer les dépendances
RUN pnpm install --frozen-lockfile

# Copier le reste des fichiers de l'application
COPY . .

# Build de l'application Next.js
RUN pnpm run build && \
    pnpm store prune && \
    rm -rf /root/.local/share/pnpm/store

# Stage 2: Production
FROM node:22-alpine AS runner

WORKDIR /app

# Créer un utilisateur non-root pour la sécurité
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Installation de pnpm et nsenter pour le runner
RUN npm install -g pnpm@8.6.7 && \
    apk add --no-cache util-linux

# Copier les fichiers nécessaires depuis le builder
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Installer uniquement les dépendances de production
# Utiliser --no-store-dir pour éviter de stocker dans le store global
# et nettoyer le cache après installation
RUN pnpm install --prod --frozen-lockfile --no-store-dir && \
    pnpm store prune && \
    rm -rf /root/.local/share/pnpm/store && \
    rm -rf /tmp/*

USER nextjs

# Exposer le port 3000
EXPOSE 3000

# Variables d'environnement
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV=production

# Commande de démarrage
CMD ["pnpm", "start"]

# Commandes utiles:
# docker build -t santu-hub-cicd:latest .
# docker run -d --name santu-hub-cicd --hostname $(hostname) --restart unless-stopped --privileged --pid host -p 3000:3000 -v /proc:/host/proc:ro -v /sys:/host/sys:ro -v /etc:/host/etc:ro santu-hub-cicd:latest
