FROM node:26-alpine
WORKDIR /app
RUN corepack enable && chown node:node /app
USER node
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --chown=node:node . .
EXPOSE 4173
CMD ["node", "scripts/start.mjs"]
