FROM node:latest

WORKDIR /app


COPY package.json package-loc.json ./

RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV = production 
EXPOSE 3000

USER node 
CMD ["node", "src/app.js"]



FROM node:latest 


WORKDIR /app


COPY package.json package-loc.json ./
RUN npm ci

COPY . .
RUN npx ng build --configuration production

FROM nginx:1.27-alpine

COPY --from=build /app/dist/smartworkforce-frontend /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
