# syntax=docker/dockerfile:1

# Build-only image: produces /app/dist. Not meant to be run — CI extracts the
# static output from the `build` stage and deploys it as plain files behind
# nginx (see deploy/nginx/marrow-ui.locations.conf and .gitlab-ci.yml).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
ARG VITE_GRAPHQL_URL=http://localhost:7000/api/graphql
ENV VITE_GRAPHQL_URL=${VITE_GRAPHQL_URL}
COPY . .
RUN npm run lint
RUN npm run build
