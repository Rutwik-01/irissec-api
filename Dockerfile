FROM node:20-alpine

WORKDIR /app

# Copy dependency files first (better Docker layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/server.js"]
