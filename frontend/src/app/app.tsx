import { Routes, Route } from "react-router";
import { AuthPage } from "../features/auth/auth-page";
import { SessionProvider } from "../features/auth/session-provider";
import { DashboardLayout } from "./dashboard-layout";

export function App() {
    return (
        <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route path="/install" element={<AuthPage install />} />
            <Route
                path="*"
                element={
                    <SessionProvider>
                        <DashboardLayout />
                    </SessionProvider>
                }
            />
        </Routes>
    );
}
