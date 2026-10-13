import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import {
  dismissInstallation, getInstallEnvironment, getInstallationSnapshot,
  promptInstallation, subscribeToInstallation,
} from "../lib/appInstallation.js";
import AppInstallGuide from "../components/install/AppInstallGuide.jsx";

const AppInstallationContext = createContext(null);

export function AppInstallationProvider({ children }) {
  const state = useSyncExternalStore(subscribeToInstallation, getInstallationSnapshot);
  const [environment] = useState(() => getInstallEnvironment(window.navigator));
  const [guideOpen, setGuideOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [now, setNow] = useState(Date.now);
  const returnFocusRef = useRef(null);
  const location = useLocation();

  useEffect(() => { setGuideOpen(false); }, [location.pathname]);
  useEffect(() => { if (state.confirmed || state.standalone) setGuideOpen(false); }, [state.confirmed, state.standalone]);
  useEffect(() => {
    setNow(Date.now());
    const remaining = state.dismissedUntil - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 1);
    return () => window.clearTimeout(timer);
  }, [state.dismissedUntil]);

  function rememberTrigger(event) {
    // Safari does not focus buttons on touch, so capture the actual opener.
    if (!guideOpen && event?.currentTarget instanceof HTMLElement) {
      returnFocusRef.current = event.currentTarget;
    }
  }

  async function install(event) {
    rememberTrigger(event);
    if (!state.prompt || environment.embedded) { setGuideOpen(true); return; }
    if (installing) return;
    setInstalling(true);
    try {
      const outcome = await promptInstallation();
      if (outcome === "unavailable") setGuideOpen(true);
      else setGuideOpen(false);
    } finally { setInstalling(false); }
  }

  const value = {
    ...state, environment, installing, install,
    canPromote: environment.mobile && !state.standalone && !state.confirmed && now >= state.dismissedUntil,
    openGuide: (event) => { rememberTrigger(event); setGuideOpen(true); },
    dismiss: dismissInstallation,
    actionLabel: state.prompt && !environment.embedded ? "Install OCS Care" : "Add to home screen",
  };

  return (
    <AppInstallationContext.Provider value={value}>
      {children}
      {guideOpen && !state.standalone ? <AppInstallGuide onClose={() => setGuideOpen(false)} returnFocusRef={returnFocusRef} /> : null}
    </AppInstallationContext.Provider>
  );
}

export function useAppInstallation() {
  const context = useContext(AppInstallationContext);
  if (!context) throw new Error("useAppInstallation must be used within AppInstallationProvider");
  return context;
}
