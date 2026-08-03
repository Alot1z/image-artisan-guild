# RIS External Proxy
#
# The mcr.microsoft.com/playwright base image ships Chromium plus all OS-level
# dependencies required for headless browser automation, so no apt-get step is
# needed here. Browsers are pre-installed at /ms-playwright.
FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app
ENV NODE_ENV=production
# Browsers are pre-installed in the base image; never re-download them during
# npm install (this also keeps the build fast and the image small).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install runtime dependencies first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

# Compile TypeScript, then strip dev dependencies from the final image.
COPY tsconfig.json ./
COPY src ./src
RUN npm install --include=dev && npm run build && npm prune --omit=dev && npm cache clean --force

# Run as an unprivileged user.
RUN useradd --create-home --shell /bin/bash proxyuser \
  && chown -R proxyuser:proxyuser /app
USER proxyuser

EXPOSE 3000

# Liveness: the /health endpoint is unauthenticated.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "dist/src/index.js"]
