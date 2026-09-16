import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

function isPrimaryPointer(event: PointerEvent): boolean {
  return event.isPrimary && event.button === 0;
}

document.addEventListener("pointerdown", (event) => {
  if (!isPrimaryPointer(event) || !(event.target instanceof Element)) {
    return;
  }

  const handle = event.target.closest<HTMLElement>(".window-drag-region");
  if (!handle) {
    return;
  }

  event.preventDefault();
  void appWindow.startDragging().catch((error) => {
    console.error("failed to start native window drag", error);
  });
});
