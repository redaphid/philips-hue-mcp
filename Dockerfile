FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY tsconfig.json ./

RUN npm install tsx

EXPOSE 3100

CMD ["npx", "tsx", "src/index.ts"]
