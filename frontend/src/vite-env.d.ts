/// <reference types="vite/client" />

// 监控配置为构建时公开标识，空 DSN 保持关闭。
interface ImportMetaEnv {
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_SENTRY_ENVIRONMENT?: string;
    readonly VITE_SENTRY_RELEASE?: string;
}
