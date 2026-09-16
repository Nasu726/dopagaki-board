import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

function isInteractiveTarget(target: Element): boolean {
  return Boolean(
    target.closest(
      "button, input, select, textarea, a, [contenteditable='true'], [role='button']",
    ),
  );
}

document.addEventListener(
  "mousedown",
  (event) => {
    if (event.button !== 0 || event.buttons !== 1) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const region = target.closest<HTMLElement>(".window-drag-region");
    if (!region || isInteractiveTarget(target)) {
      return;
    }

    // The native data-tauri drag region has been unreliable on the Windows
    // real-device build. Own this interaction explicitly so one pointer-down
    // maps to exactly one native startDragging call.
    event.preventDefault();
    event.stopImmediatePropagation();
    void appWindow.startDragging().catch((error) => {
      console.error("failed to start window drag", error);
    });
  },
  true,
);
