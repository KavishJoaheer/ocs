import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./hooks/usePatientAuth.jsx";
import App from "./App.jsx";
import "./index.css";
import { registerServiceWorker, syncPushSubscriptionIfGranted } from "./lib/pushNotifications.js";

registerServiceWorker()
  .then(() => syncPushSubscriptionIfGranted())
  .catch(() => {});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: "16px",
              background: "rgba(255,255,255,0.95)",
              color: "#22485b",
              border: "1px solid rgba(65,200,198,0.2)",
              boxShadow: "0 16px 48px rgba(34,72,91,0.12)",
              fontFamily: '"Nunito Sans", sans-serif',
              fontSize: "14px",
              fontWeight: "600",
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
