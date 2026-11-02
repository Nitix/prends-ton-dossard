# Three stages: the front end, then the Go program that embeds it, then a
# minimal image that only holds the program.

# --- Stage 1: build the front end ------------------------------------------
FROM node:26-slim AS web
WORKDIR /src

# Node 25 and later no longer ship Corepack, so pnpm comes from npm, at the
# exact version that package.json pins in "packageManager".
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")"

# The dependencies come first: this layer is rebuilt only when they change.
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

# "pnpm --dir web build" writes server/webdist/dist, the directory that the Go
# program embeds. VITE_SKIN_DEPTH is the depth of the skins of the build
# (web/src/skins/README.md), which compose.yaml takes from .env: palette when it
# is empty.
COPY web web
ARG VITE_SKIN_DEPTH=
RUN pnpm --dir web build

# --- Stage 2: build the Go program, with the front end embedded -------------
FROM golang:1.27 AS server
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY server server
COPY --from=web /src/server/webdist/dist server/webdist/dist
# CGO is off: PocketBase uses a pure Go SQLite driver, and the binary has to run
# on Alpine (musl). time/tzdata is embedded, so the image needs no tzdata.
RUN CGO_ENABLED=0 go build -o /out/courses ./server

# --- Stage 3: the final image ----------------------------------------------
FROM alpine:3.24

# The program runs as an unprivileged user that owns the data directory. A new
# volume mounted on /pb_data takes this owner.
RUN adduser -D -u 10001 courses \
    && mkdir /pb_data \
    && chown courses /pb_data

COPY --from=server /out/courses /app/courses

# PocketBase looks for its data in "pb_data" next to the executable unless
# --dir says otherwise, and "serve" gets --dir from CMD below. The commands run
# with "docker compose exec" (superuser, bootstrap-admin, seed) do not get it:
# this link sends them to the same data.
RUN ln -s /pb_data /app/pb_data

USER courses
EXPOSE 8090
ENTRYPOINT ["/app/courses"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb_data"]
