import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

function homepageDevUrl() {
    return {
        name: "homepage-dev-url",
        configureServer(server) {
            const printUrls = server.printUrls.bind(server);
            server.printUrls = () => {
                const urls = server.resolvedUrls;
                if (!urls) return printUrls();
                // 仅调整终端入口，保留后台资源基路径和服务器原始地址。
                server.resolvedUrls = {
                    local: urls.local.map((url) => new URL("/", url).href),
                    network: urls.network.map((url) => new URL("/", url).href),
                };
                try {
                    return printUrls();
                } finally {
                    server.resolvedUrls = urls;
                }
            };
        },
    };
}

function adminBaseRedirect() {
    const configureServer = (server) => {
        server.middlewares.use((request, response, next) => {
            const [pathname, query] = (request.url ?? "").split(/\?(.*)/s);
            if ((request.method === "GET" || request.method === "HEAD") && pathname === "/admin") {
                response.writeHead(302, {
                    Location: `/admin/${query === undefined ? "" : `?${query}`}`,
                });
                response.end();
                return;
            }
            next();
        });
    };
    return {
        name: "admin-base-redirect",
        configureServer,
        configurePreviewServer: configureServer,
    };
}

export default defineConfig(({ mode }) => {
    const envDir = fileURLToPath(new URL(".", import.meta.url));
    const env = loadEnv(mode, envDir, ["SPA_PORT", "WEB_ORIGIN"]);
    const marker = new URL("../../../package.json", import.meta.url);
    const local =
        existsSync(marker) &&
        JSON.parse(readFileSync(marker, "utf8")).name === "go-full-stack-starter";
    const dashboardSource =
        process.env.DASHBOARD_SOURCE !== undefined ? process.env.DASHBOARD_SOURCE === "1" : local;
    const dashboardDirectory = new URL(
        "../../../packages/shadcnui-dashboard/src/",
        import.meta.url,
    );
    return {
        envDir,
        base: "/admin/",
        cacheDir: process.env.VITE_CACHE_DIR,
        resolve: {
            alias: dashboardSource
                ? [
                      {
                          find: /^@shanjing\/shadcnui-dashboard$/,
                          replacement: fileURLToPath(new URL("index.ts", dashboardDirectory)),
                      },
                      {
                          find: /^@shanjing\/shadcnui-dashboard\/styles\.css$/,
                          replacement: fileURLToPath(new URL("styles.css", dashboardDirectory)),
                      },
                  ]
                : [],
        },
        plugins: [
            homepageDevUrl(),
            adminBaseRedirect(),
            ...(dashboardSource
                ? [
                      {
                          name: "dashboard-source-styles",
                          enforce: "pre",
                          transform(code, id) {
                              const stylesheet = fileURLToPath(
                                  new URL("./src/styles/global.css", import.meta.url),
                              );
                              if (id.split("?")[0] !== stylesheet) return;
                              const source = fileURLToPath(dashboardDirectory).replaceAll(
                                  "\\",
                                  "/",
                              );
                              return {
                                  code: code.replace(
                                      '@source "../../node_modules/@shanjing/shadcnui-dashboard/src";',
                                      `@source "${source}";`,
                                  ),
                                  map: null,
                              };
                          },
                      },
                  ]
                : []),
            react(),
            tailwindcss(),
        ],
        server: {
            host: "127.0.0.1",
            port: Number(env.SPA_PORT || 5173),
            strictPort: true,
            proxy: {
                "^/$": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080" },
                "/test/bus": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080" },
                "/test/queue": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080" },
                "/public/": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080" },
                "/admin/assets/": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080" },
                "/api": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080", ws: true },
                "/health": { target: env.WEB_ORIGIN || "http://127.0.0.1:8080" },
            },
        },
        build: {
            outDir: "../backend/internal/web/dist",
            emptyOutDir: true,
            manifest: "manifest.json",
            // 后台同步加载，公开页保持独立入口，单文件预算 1 MB。
            chunkSizeWarningLimit: 1000,
            rolldownOptions: {
                input: {
                    admin: fileURLToPath(new URL("./index.html", import.meta.url)),
                    public: fileURLToPath(new URL("./src/public.ts", import.meta.url)),
                },
            },
        },
    };
});
