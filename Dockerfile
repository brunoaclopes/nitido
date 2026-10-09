# Nítido, self-hosted: the app with its AI models and libraries inside, and the small server that keeps
# profiles in /data. The page then makes no request outside this server.
#   docker build -t nitido .                                (every AI tier, about 1 GB)
#   docker build --build-arg TIERS=standard -t nitido .     (one tier; see README for the others)
#   docker run -p 8080:8080 -v ./data:/data nitido          → serve it over HTTPS (README, "HTTPS on your network")

# the models and libraries are the same on every platform: fetch them once, on the build machine
FROM --platform=$BUILDPLATFORM node:22-alpine AS models
ARG TIERS=all
WORKDIR /app
COPY src/ml ./src/ml
COPY scripts/fetch-models.mjs ./scripts/
RUN node scripts/fetch-models.mjs $TIERS

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache su-exec
COPY index.html config.js sw.js manifest.webmanifest icon.svg server.mjs docker-entrypoint.sh package.json LICENSE ./
COPY styles ./styles
COPY fonts ./fonts
COPY src ./src
COPY --from=models /app/models ./models
ENV HOST=0.0.0.0 PORT=8080 NITIDO_DATA=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/config.js > /dev/null || exit 1
# starts as root only to hand /data to PUID:PGID, then runs as that user
ENTRYPOINT ["/app/docker-entrypoint.sh"]
