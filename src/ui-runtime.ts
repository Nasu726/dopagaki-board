import { getCurrentWindow } from "@tauri-apps/api/window";
import "./interaction-fixes.css";

const appWindow = getCurrentWindow();

function isInteractiveTarget(target: Element): boolean {
  return Boolean(
    target.closest(
      "button, input, select, textarea, a, [contenteditable='true'], [role='button']",
    ),
  );
}

function markResizeHandlesPointerOnly(root: ParentNode): void {
  const handles: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches("[data-resize-handle]")) {
    handles.push(root);
  }
  handles.push(...root.querySelectorAll<HTMLElement>("[data-resize-handle]"));

  for (const handle of handles) {
    handle.tabIndex = -1;
    handle.setAttribute("aria-hidden", "true");
  }
}

markResizeHandlesPointerOnly(document);

const resizeObserver = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) {
        markResizeHandlesPointerOnly(node);
      }
    }
  }
});
resizeObserver.observe(document.documentElement, { childList: true, subtree: true });

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

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const content = target.closest<HTMLElement>("[data-widget-content]");
  if (!content || !content.closest(".board-widget--youtube")) {
    return;
  }
  if (!content.querySelector(".board-widget__empty")) {
    return;
  }

  const widget = content.closest<HTMLElement>("[data-widget-id]");
  widget?.querySelector<HTMLButtonElement>("[data-config-widget]")?.click();
});
