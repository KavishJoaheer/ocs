import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./hooks/useAuth.jsx";
import {
  drainPendingServiceWorkerSubscription,
  fetchPushConfiguration,
  isPushSupported,
  listenForPushSubscriptionChanges,
  persistPushSubscriptionPayload,
  registerServiceWorker,
} from "./lib/pushNotifications.js";
import { startOfflineSyncListener } from "./lib/inventoryOfflineSync.js";

if (isPushSupported()) {
  registerServiceWorker()
    .then(async () => {
      // Seed the SW with the VAPID public key so it can recover from
      // pushsubscriptionchange events on its own (especially on iOS, where
      // the browser may rotate subscriptions while the PWA is closed).
      await fetchPushConfiguration();
      // Drain any subscription the SW minted while no window was alive.
      await drainPendingServiceWorkerSubscription();
    })
    .catch(() => {
      // Service worker registration is best-effort during app boot.
    });

  // Mount the subscription-change bridge outside the auth shell so it keeps
  // syncing even before the user logs in / during session restore / on the
  // login page. The server endpoint requires auth, so persistence is a
  // no-op until a session is restored — at which point the call succeeds.
  listenForPushSubscriptionChanges((subscriptionJson) => {
    if (!subscriptionJson) return;
    void persistPushSubscriptionPayload(subscriptionJson);
  });
}

startOfflineSyncListener();

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
