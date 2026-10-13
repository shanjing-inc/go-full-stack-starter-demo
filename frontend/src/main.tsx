import * as Sentry from "@sentry/react";
import { initializeMonitoring } from "./lib/observability";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/app";
import "./styles/global.css";

const monitored = initializeMonitoring(import.meta.env);
createRoot(
    document.getElementById("root")!,
    monitored
        ? {
              onUncaughtError: Sentry.reactErrorHandler(),
              onRecoverableError: Sentry.reactErrorHandler(),
          }
        : undefined,
).render(
    <StrictMode>
        <Sentry.ErrorBoundary fallback={<p role="alert">页面发生异常，请刷新后重试。</p>}>
            <BrowserRouter basename="/admin">
                <App />
            </BrowserRouter>
        </Sentry.ErrorBoundary>
    </StrictMode>,
);
