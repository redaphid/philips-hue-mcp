FROM node:25-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY tsconfig.json ./

ENV PORT=3100
EXPOSE 3100

CMD ["node", "src/index.ts"]
