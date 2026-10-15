FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js events.js ./
COPY lib ./lib

ENV NODE_ENV=production

CMD ["node", "index.js"]
