# Generated — chat-runtime container image (Node entry src/index.ts).
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
