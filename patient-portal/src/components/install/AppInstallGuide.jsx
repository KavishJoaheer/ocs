import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Ellipsis, House, Menu, Plus, Share, Smartphone, X } from "lucide-react";
import { useAppInstallation } from "../../hooks/useAppInstallation.jsx";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useScrollLock } from "../../hooks/useScrollLock.js";
import { getInstallGuide } from "../../lib/appInstallation.js";

const stepIcons = { share: Share, plus: Plus, home: House, menu: Menu };

export default function AppInstallGuide({ onClose, returnFocusRef }) {
  const { environment, prompt, installing, install, dismiss } = useAppInstallation();
  const [browser, setBrowser] = useState(environment.browser);
  const [copyStatus, setCopyStatus] = useState("");
  const container = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const guide = getInstallGuide(browser);
  const canInstall = prompt && !environment.embedded;
  useFocusTrap(true, container, returnFocusRef);
  useScrollLock(true);

  useEffect(() => {
    function handleEscape(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/`);
      setCopyStatus("Link copied. Open it in your phone’s browser.");
    } catch {
      setCopyStatus("Select and copy the address below.");
    }
  }

  function handleLater() { dismiss(); onClose(); }

  return createPortal(
    <div className="care-install-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={container} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} className="care-install-guide">
        <div className="care-install-guide-header">
          <span className="care-install-eyebrow"><Smartphone size={16} aria-hidden="true" /> OCS Care on your phone</span>
          <button type="button" onClick={onClose} className="care-install-icon-button" aria-label="Close installation guide"><X size={21} /></button>
        </div>
        <div className="care-install-guide-body">
          <img src="/pwa-192.png" alt="" className="care-install-app-icon" />
          <h2 id={titleId}>Your care, one tap away.</h2>
          <p id={descriptionId} className="care-install-description">Keep appointments and health records close. Add OCS Care to your home screen.</p>
          {environment.embedded ? <div className="care-install-browser-notice"><Ellipsis size={20} aria-hidden="true" /><p>Open this page in your phone’s browser first. Use this app’s menu and choose Open in browser, or copy the link below.</p></div> : null}
          <label htmlFor={`${titleId}-browser`} className="care-install-browser-label">Instructions for</label>
          <select id={`${titleId}-browser`} value={browser} onChange={(event) => setBrowser(event.target.value)} className="care-install-browser-select">
            <option value="ios">iPhone / iPad · Safari</option>
            <option value="samsung">Samsung Internet</option>
            <option value="huawei">Huawei Browser</option>
            <option value="chrome">Google Chrome</option>
            <option value="edge">Microsoft Edge</option>
            <option value="firefox">Firefox</option>
            <option value="other">Other browser</option>
          </select>
          <ol className="care-install-steps" aria-label={`${guide.name} instructions`}>
            {guide.steps.map((step, index) => {
              const Icon = stepIcons[step.icon];
              return (
                <li key={step.title}>
                  <span className="care-install-step-icon" aria-hidden="true">
                    <Icon size={21} strokeWidth={1.8} />
                  </span>
                  <div>
                    <span className="care-install-step-number">Step {index + 1}</span>
                    <h3>{step.title}</h3>
                    <p>{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="care-install-note">{guide.note}</p>
          <div className="care-install-link-row"><input aria-label="OCS Care link" readOnly value={`${window.location.origin}/`} onFocus={(event) => event.target.select()} /><button type="button" onClick={copyLink} className="care-install-icon-button" aria-label="Copy OCS Care link">{copyStatus.startsWith("Link copied") ? <Check size={20} /> : <Copy size={20} />}</button></div>
          <p role="status" className="care-install-copy-status">{copyStatus}</p>
        </div>
        <div className="care-install-guide-footer">
          {canInstall ? <button type="button" onClick={install} disabled={installing} className="care-install-primary">{installing ? "Opening installation…" : "Install OCS Care"}</button> : <button type="button" onClick={handleLater} className="care-install-primary">Got it</button>}
          <button type="button" onClick={handleLater} className="care-install-later">Maybe later</button>
        </div>
      </section>
    </div>, document.body,
  );
}
