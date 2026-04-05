# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/

# Stage 2: Run
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
CMD ["node", "src/app.js"]
