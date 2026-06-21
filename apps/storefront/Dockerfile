FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY apps/storefront/package.json ./apps/storefront/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/ui-components/package.json ./packages/ui-components/package.json
RUN npm ci

COPY apps/storefront ./apps/storefront
COPY packages/api-client ./packages/api-client
COPY packages/shared-types ./packages/shared-types
COPY packages/ui-components ./packages/ui-components

WORKDIR /app/apps/storefront

EXPOSE 3000

ENV NODE_OPTIONS="--max-old-space-size=4096"

CMD ["sh", "-c", "rm -rf .next && npm run build && npm run start"]