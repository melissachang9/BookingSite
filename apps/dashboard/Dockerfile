FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/ui-components/package.json ./packages/ui-components/package.json
RUN npm ci

COPY apps/dashboard ./apps/dashboard
COPY packages/api-client ./packages/api-client
COPY packages/shared-types ./packages/shared-types
COPY packages/ui-components ./packages/ui-components

WORKDIR /app/apps/dashboard

EXPOSE 5173

ENV NODE_OPTIONS="--max-old-space-size=4096"

CMD ["npm", "run", "dev"]