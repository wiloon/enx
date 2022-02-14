FROM vuejs/ci:latest AS build
WORKDIR /workdir
COPY . .

RUN yarn config get registry
# RUN yarn config set registry https://registry.npm.taobao.org/
# RUN yarn config get registry
RUN yarn global add vue
RUN yarn global add @vue/cli
RUN yarn global add @vue/cli-service
RUN yarn global add @vue/cli-plugin-babel
RUN yarn global add @vue/cli-plugin-e2e-cypress
RUN yarn global add @vue/cli-plugin-eslint
RUN yarn global add @vue/cli-plugin-pwa
RUN yarn global add @vue/cli-plugin-typescript
RUN yarn global add @vue/cli-plugin-unit-jest
RUN yarn global add vue-cli-plugin-vuetify
RUN yarn add @vue/cli-plugin-babel
RUN yarn add @mdi/font -D
RUN yarn global add lerna
RUN yarn global add typescript
RUN yarn build

FROM nginx:1.18.0-alpine AS prod
COPY --from=build /workdir/dist/ /usr/share/nginx/html/
COPY nginx-default.conf /etc/nginx/conf.d/default.conf

