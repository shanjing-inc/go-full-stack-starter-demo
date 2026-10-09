# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.15.0-bookworm-slim
ARG GO_IMAGE=golang:1.26.8-bookworm
FROM ${NODE_IMAGE} AS frontend
WORKDIR /src
RUN npm install --global pnpm@11.15.1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY frontend/ frontend/
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm install --frozen-lockfile && pnpm build:frontend
FROM ${GO_IMAGE} AS backend
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOWORK=off GOPRIVATE=codeup.aliyun.com/shanjing
WORKDIR /src
COPY . ./
COPY --from=frontend /src/webui/dist/ webui/dist/
RUN --mount=type=secret,id=netrc,target=/root/.netrc --mount=type=secret,id=gitconfig,target=/root/.gitconfig --mount=type=secret,id=known_hosts,target=/root/.ssh/known_hosts --mount=type=ssh go mod download && go mod verify
RUN go build -mod=readonly -trimpath -o /out/web ./cmd/web && go build -mod=readonly -trimpath -o /out/worker ./cmd/worker
FROM scratch
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=backend /out/web /web
COPY --from=backend /out/worker /worker
USER 65532:65532
ENV WEB_ADDR=0.0.0.0:8080
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["/web"]
