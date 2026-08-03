FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install --include=dev && npm run build && npm prune --omit=dev

RUN useradd --create-home --shell /bin/bash proxyuser \
  && chown -R proxyuser:proxyuser /app
USER proxyuser

EXPOSE 3000
CMD ["node", "dist/src/index.js"]
