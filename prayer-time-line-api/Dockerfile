FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY src/ ./src/
COPY scripts/ ./scripts/
EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080
CMD ["npm", "start"]

