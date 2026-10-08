# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.15.0-bookworm-slim
ARG GO_IMAGE=golang:1.26.8-bookworm
FROM ${NODE_IMAGE} AS frontend
WORKDIR /src
RUN npm install --global pnpm@11.15.1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shadcnui-dashboard/ packages/shadcnui-dashboard/
COPY projects/multi-database-demo/frontend/ projects/multi-database-demo/frontend/
COPY scripts/copy-dashboard-css.mjs scripts/clean-dashboard.mjs scripts/
RUN pnpm install --frozen-lockfile && pnpm build:frontend
FROM ${GO_IMAGE} AS backend
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /src
COPY go.work go.work.sum ./
COPY packages/go-server-kit/ packages/go-server-kit/
COPY projects/multi-database-demo/ projects/multi-database-demo/
COPY --from=frontend /src/projects/multi-database-demo/webui/dist/ projects/multi-database-demo/webui/dist/
WORKDIR /src/projects/multi-database-demo
RUN go mod download && go mod verify
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
