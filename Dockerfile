# Container image for the Waitlister MCP server (stdio transport).
#
#   docker build -t waitlister-mcp .
#   docker run -i --rm -e WAITLISTER_ACCOUNT_KEY=wl_acct_your-key waitlister-mcp

# Build stage: compile the TypeScript sources.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the package's "prepare" script runs the build, and the
# sources are copied in only after the dependencies are installed.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies and the compiled server only.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build
USER node
ENTRYPOINT ["node", "build/index.js"]
