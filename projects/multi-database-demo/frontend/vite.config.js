import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
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

export default defineConfig({
    base: "/admin/",
    cacheDir: process.env.VITE_CACHE_DIR,
    resolve: {
        alias:
            process.env.DASHBOARD_SOURCE === "1"
                ? [
                      {
                          find: /^@shanjing\/shadcnui-dashboard$/,
                          replacement: fileURLToPath(
                              new URL(
                                  "../../../packages/shadcnui-dashboard/src/index.ts",
                                  import.meta.url,
                              ),
                          ),
                      },
                      {
                          find: /^@shanjing\/shadcnui-dashboard\/styles\.css$/,
                          replacement: fileURLToPath(
                              new URL(
                                  "../../../packages/shadcnui-dashboard/src/styles.css",
                                  import.meta.url,
                              ),
                          ),
                      },
                  ]
                : [],
    },
    plugins: [homepageDevUrl(), adminBaseRedirect(), react(), tailwindcss()],
    server: {
        host: "127.0.0.1",
        port: Number(process.env.SPA_PORT || 5173),
        strictPort: true,
        proxy: {
            "^/$": { target: process.env.WEB_ORIGIN || "http://127.0.0.1:8080" },
            "/test/queue": { target: process.env.WEB_ORIGIN || "http://127.0.0.1:8080" },
            "/public/": { target: process.env.WEB_ORIGIN || "http://127.0.0.1:8080" },
            "/admin/assets/": { target: process.env.WEB_ORIGIN || "http://127.0.0.1:8080" },
            "/api": { target: process.env.WEB_ORIGIN || "http://127.0.0.1:8080", ws: true },
            "/health": { target: process.env.WEB_ORIGIN || "http://127.0.0.1:8080" },
        },
    },
    build: {
        outDir: "../webui/dist",
        emptyOutDir: true,
        manifest: "manifest.json",
        rollupOptions: {
            input: {
                admin: fileURLToPath(new URL("./index.html", import.meta.url)),
                public: fileURLToPath(new URL("./src/public.ts", import.meta.url)),
            },
        },
    },
});
