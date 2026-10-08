import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app";
import "./style.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter basename="/admin">
            <App />
        </BrowserRouter>
    </StrictMode>,
);
