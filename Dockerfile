# Kova, Trust layer for the agent economy
# Production image with full monorepo build

FROM node:20-alpine

WORKDIR /app

# Copy workspace config and package files
COPY package.json package-lock.json* ./
COPY packages ./packages

# Install and build
RUN npm install && npm run build

ENV NODE_ENV=production

# Run kova CLI (stele audit, help, etc.)
ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["help"]
