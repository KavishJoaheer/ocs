import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./hooks/useAuth.jsx";
import { isPushSupported, registerServiceWorker } from "./lib/pushNotifications.js";

if (isPushSupported()) {
  registerServiceWorker().catch(() => {
    // Service worker registration is best-effort during app boot.
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              borderRadius: "18px",
              border: "1px solid rgba(65, 200, 198, 0.18)",
              background: "linear-gradient(180deg, #ffffff, #f1fbfa)",
              color: "#22485b",
              boxShadow: "0 20px 45px rgba(34, 72, 91, 0.14)",
            },
          }}
        />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
