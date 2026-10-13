import { useEffect } from "react";

// Keep keyboard space available in Safari, Samsung Internet and Huawei Browser.
export function useMobileTyping() {
  useEffect(() => {
    let frame = 0;
    function update() {
      const element = document.activeElement;
      const textInput = element instanceof HTMLInputElement && !["checkbox", "radio", "range", "color", "button", "submit", "reset", "file", "image", "hidden"].includes(element.type);
      const editing = Boolean(element && !element.readOnly && (textInput || element instanceof HTMLTextAreaElement || element.isContentEditable));
      document.body.toggleAttribute("data-mobile-typing", editing);
    }
    function afterBlur() { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(update); }
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", afterBlur);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", afterBlur);
      document.body.removeAttribute("data-mobile-typing");
    };
  }, []);
}
