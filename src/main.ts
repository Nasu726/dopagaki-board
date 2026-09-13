import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

type ViewState = "hidden" | "idle" | "compact" | "board";
type ViewEvent = "globalToggle" | "clickIdleOrb" | "openBoard" | "hide";

type ShellStatus = {
  hasUnseen: boolean;
  globalShortcut: string;
  globalShortcutError: string | null;
};

type WidgetLayout = {
  id: number;
  sourceKind: string;
  sourceConfigJson: string;
  refreshConfigJson: string;
  x: number;
  y: number;
  width: number;
  height: number;
  displayMode: string;
};

type Point = { x: number; y: number };

const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  arxiv: "arXiv",
  wikipedia: "Wikipedia",
  nhk: "NHK",
  qiita: "Qiita",
  zenn: "Zenn",
};

const DEFAULT_WIDGET_WIDTH = 280;
const DEFAULT_WIDGET_HEIGHT = 180;
const MIN_WIDGET_WIDTH = 140;
const MIN_WIDGET_HEIGHT = 96;
const DEFAULT_GLOBAL_SHORTCUT = "CmdOrCtrl+Shift+Space";

function getAppRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) {
    throw new Error("#app root was not found");
  }
  return element;
}

const root = getAppRoot();
let currentView: ViewState = "idle";
let shellStatus: ShellStatus = {
  hasUnseen: false,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutError: null,
};
let boardWidgets: WidgetLayout[] = [];
let boardLoaded = false;
let addPoint: Point | null = null;
let shortcutPopoverOpen = false;
let shortcutFormError: string | null = null;

function render(): void {
  document.documentElement.dataset.view = currentView;

  switch (currentView) {
    case "hidden":
      root.replaceChildren();
      break;
    case "idle":
      renderIdle();
      break;
    case "compact":
      renderCompact();
      break;
    case "board":
      renderBoard();
      break;
  }
}

function renderIdle(): void {
  root.innerHTML = `
    <main class="idle-shell">
      <button id="idle-orb" class="idle-orb" type="button" aria-label="Open dopagaki-board">
        <span class="idle-orb__surface" aria-hidden="true"></span>
        <span class="idle-orb__badge" aria-hidden="true"${shellStatus.hasUnseen ? "" : " hidden"}></span>
      </button>
    </main>
  `;

  document.querySelector("#idle-orb")?.addEventListener("click", () => {
    void transitionView("clickIdleOrb");
  });
}

function renderCompact(): void {
  const shortcutWarning = shellStatus.globalShortcutError
    ? `<button class="shortcut-warning" data-action="shortcut-settings" type="button">Shortcut unavailable</button>`
    : "";

  root.innerHTML = `
    <main class="compact-shell" aria-label="Quick discovery">
      <header class="compact-toolbar">
        <span class="compact-mark" aria-hidden="true"></span>
        <span class="compact-title">dopagaki</span>
        ${shortcutWarning}
        <button class="icon-button" data-action="board" type="button" aria-label="Open Board">▦</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle">×</button>
      </header>

      <section class="compact-feed" aria-label="Prototype content">
        <button class="content-card content-card--visual" data-url="https://www.youtube.com/" type="button">
          <span class="content-card__source">YouTube</span>
          <span class="content-card__media content-card__media--youtube" aria-hidden="true"></span>
          <span class="content-card__hint">prototype · one click</span>
        </button>

        <button class="content-card content-card--text" data-url="https://arxiv.org/" type="button">
          <span class="content-card__source">arXiv</span>
          <strong>Interesting paper goes here.</strong>
          <span class="content-card__hint">prototype · one click</span>
        </button>
      </section>
    </main>
  `;

  document.querySelector('[data-action="board"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = false;
    void transitionView("openBoard");
  });

  document.querySelector('[data-action="shortcut-settings"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = true;
    shortcutFormError = shellStatus.globalShortcutError;
    void transitionView("openBoard");
  });

  document.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
    void transitionView("globalToggle");
  });

  for (const card of document.querySelectorAll<HTMLElement>("[data-url]")) {
    card.addEventListener("click", () => {
      const url = card.dataset.url;
      if (url) {
        void openContent(url);
      }
    });
  }
}

function renderBoard(): void {
  const widgetMarkup = boardWidgets.map(renderWidgetMarkup).join("");
  const pickerMarkup = addPoint ? renderAddPickerMarkup(addPoint) : "";
  const shortcutPopoverMarkup = shortcutPopoverOpen ? renderShortcutPopoverMarkup() : "";

  root.innerHTML = `
    <main class="board-shell">
      <header class="board-toolbar">
        <strong>Board</strong>
        <span class="board-toolbar__hint">Click empty space to add · drag to move</span>
        <button class="icon-button" data-action="shortcut-settings" type="button" aria-label="Global shortcut settings">⌨</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle">×</button>
      </header>
      <section class="board-canvas${boardWidgets.length === 0 ? " board-canvas--empty" : ""}" aria-label="Discovery Board">
        ${widgetMarkup}
        ${pickerMarkup}
      </section>
      ${shortcutPopoverMarkup}
    </main>
  `;

  document.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = false;
    void transitionView("globalToggle");
  });

  document.querySelector('[data-action="shortcut-settings"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = !shortcutPopoverOpen;
    shortcutFormError = null;
    addPoint = null;
    renderBoard();
  });

  const canvas = document.querySelector<HTMLElement>(".board-canvas");
  canvas?.addEventListener("pointerdown", handleBoardPointerDown);

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-add-source]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const sourceKind = button.dataset.addSource;
      if (sourceKind && addPoint) {
        void addBoardWidget(sourceKind, addPoint);
      }
    });
  }

  document.querySelector('[data-action="cancel-add"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    addPoint = null;
    renderBoard();
  });

  bindShortcutPopover();
  bindWidgetInteractions();

  if (!boardLoaded) {
    boardLoaded = true;
    void loadBoardWidgets();
  }
}

function renderWidgetMarkup(widget: WidgetLayout): string {
  const label = SOURCE_LABELS[widget.sourceKind] ?? "Source";
  return `
    <article
      class="board-widget board-widget--${widget.sourceKind}"
      data-widget-id="${widget.id}"
      style="left:${widget.x}px;top:${widget.y}px;width:${widget.width}px;height:${widget.height}px"
    >
      <div class="board-widget__drag" data-drag-handle>
        <span>${label}</span>
        <button class="board-widget__delete" data-delete-widget type="button" aria-label="Delete ${label}">×</button>
      </div>
      <div class="board-widget__content" aria-hidden="true">
        <span class="board-widget__preview">${label}</span>
      </div>
      <button class="board-widget__resize" data-resize-handle type="button" aria-label="Resize ${label}"></button>
    </article>
  `;
}

function renderAddPickerMarkup(point: Point): string {
  return `
    <aside class="add-picker" style="left:${point.x}px;top:${point.y}px" aria-label="Add widget">
      <div class="add-picker__header">
        <strong>Add</strong>
        <button data-action="cancel-add" type="button" aria-label="Cancel">×</button>
      </div>
      <div class="add-picker__sources">
        ${Object.entries(SOURCE_LABELS)
          .map(
            ([kind, label]) =>
              `<button data-add-source="${kind}" type="button">${label}</button>`,
          )
          .join("")}
      </div>
    </aside>
  `;
}

function renderShortcutPopoverMarkup(): string {
  return `
    <aside class="shortcut-popover" aria-label="Global shortcut settings">
      <form id="shortcut-form">
        <label for="shortcut-input">Global shortcut</label>
        <input id="shortcut-input" type="text" autocomplete="off" spellcheck="false" aria-describedby="shortcut-help shortcut-error">
        <p id="shortcut-help">Example: CmdOrCtrl+Shift+Space</p>
        <p id="shortcut-error" class="shortcut-popover__error" hidden></p>
        <div class="shortcut-popover__actions">
          <button data-action="cancel-shortcut" type="button">Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </aside>
  `;
}

function bindShortcutPopover(): void {
  if (!shortcutPopoverOpen) {
    return;
  }

  const input = document.querySelector<HTMLInputElement>("#shortcut-input");
  const form = document.querySelector<HTMLFormElement>("#shortcut-form");
  const errorElement = document.querySelector<HTMLElement>("#shortcut-error");
  if (!input || !form || !errorElement) {
    return;
  }

  input.value = shellStatus.globalShortcut;
  const message = shortcutFormError ?? shellStatus.globalShortcutError;
  if (message) {
    errorElement.textContent = message;
    errorElement.hidden = false;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveGlobalShortcut(input.value);
  });

  document.querySelector('[data-action="cancel-shortcut"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = false;
    shortcutFormError = null;
    renderBoard();
  });

  input.focus();
  input.select();
}

function handleBoardPointerDown(event: PointerEvent): void {
  const canvas = event.currentTarget as HTMLElement;
  if (event.target !== canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, Math.max(0, rect.width - DEFAULT_WIDGET_WIDTH));
  const y = clamp(event.clientY - rect.top, 0, Math.max(0, rect.height - DEFAULT_WIDGET_HEIGHT));
  addPoint = { x: Math.round(x), y: Math.round(y) };
  shortcutPopoverOpen = false;
  shortcutFormError = null;
  renderBoard();
}

function bindWidgetInteractions(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-widget-id]")) {
    const id = Number(element.dataset.widgetId);
    if (!Number.isFinite(id)) {
      continue;
    }

    element.querySelector<HTMLElement>("[data-drag-handle]")?.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("[data-delete-widget]")) {
        return;
      }
      startDrag(event, element, id);
    });

    element.querySelector<HTMLElement>("[data-resize-handle]")?.addEventListener("pointerdown", (event) => {
      startResize(event, element, id);
    });

    element.querySelector<HTMLElement>("[data-delete-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeBoardWidget(id);
    });
  }
}

function startDrag(event: PointerEvent, element: HTMLElement, id: number): void {
  event.preventDefault();
  event.stopPropagation();

  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);

  const canvas = element.parentElement as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  const initialX = element.offsetLeft;
  const initialY = element.offsetTop;

  const move = (next: PointerEvent): void => {
    const maxX = Math.max(0, canvas.clientWidth - element.offsetWidth);
    const maxY = Math.max(0, canvas.clientHeight - element.offsetHeight);
    const x = clamp(initialX + next.clientX - startX, 0, maxX);
    const y = clamp(initialY + next.clientY - startY, 0, maxY);
    element.style.left = `${Math.round(x)}px`;
    element.style.top = `${Math.round(y)}px`;
  };

  const end = (): void => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    updateLocalGeometry(id, element);
    void persistWidgetGeometry(id, element);
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function startResize(event: PointerEvent, element: HTMLElement, id: number): void {
  event.preventDefault();
  event.stopPropagation();

  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);

  const canvas = element.parentElement as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  const initialWidth = element.offsetWidth;
  const initialHeight = element.offsetHeight;

  const move = (next: PointerEvent): void => {
    const maxWidth = Math.max(MIN_WIDGET_WIDTH, canvas.clientWidth - element.offsetLeft);
    const maxHeight = Math.max(MIN_WIDGET_HEIGHT, canvas.clientHeight - element.offsetTop);
    const width = clamp(initialWidth + next.clientX - startX, MIN_WIDGET_WIDTH, maxWidth);
    const height = clamp(initialHeight + next.clientY - startY, MIN_WIDGET_HEIGHT, maxHeight);
    element.style.width = `${Math.round(width)}px`;
    element.style.height = `${Math.round(height)}px`;
  };

  const end = (): void => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    updateLocalGeometry(id, element);
    void persistWidgetGeometry(id, element);
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function updateLocalGeometry(id: number, element: HTMLElement): void {
  const widget = boardWidgets.find((item) => item.id === id);
  if (!widget) {
    return;
  }
  widget.x = element.offsetLeft;
  widget.y = element.offsetTop;
  widget.width = element.offsetWidth;
  widget.height = element.offsetHeight;
}

async function loadBoardWidgets(): Promise<void> {
  try {
    boardWidgets = await invoke<WidgetLayout[]>("list_widgets");
    if (currentView === "board") {
      renderBoard();
    }
  } catch (error) {
    boardLoaded = false;
    console.error("failed to load board widgets", error);
  }
}

async function addBoardWidget(sourceKind: string, point: Point): Promise<void> {
  const canvas = document.querySelector<HTMLElement>(".board-canvas");
  const availableWidth = canvas ? Math.max(0, canvas.clientWidth - point.x) : DEFAULT_WIDGET_WIDTH;
  const availableHeight = canvas ? Math.max(0, canvas.clientHeight - point.y) : DEFAULT_WIDGET_HEIGHT;
  const width = clamp(Math.min(DEFAULT_WIDGET_WIDTH, availableWidth), MIN_WIDGET_WIDTH, DEFAULT_WIDGET_WIDTH);
  const height = clamp(
    Math.min(DEFAULT_WIDGET_HEIGHT, availableHeight),
    MIN_WIDGET_HEIGHT,
    DEFAULT_WIDGET_HEIGHT,
  );

  try {
    const widget = await invoke<WidgetLayout>("add_widget", {
      sourceKind,
      x: point.x,
      y: point.y,
      width,
      height,
    });
    boardWidgets.push(widget);
    addPoint = null;
    renderBoard();
  } catch (error) {
    console.error("failed to add widget", error);
  }
}

async function persistWidgetGeometry(id: number, element: HTMLElement): Promise<void> {
  try {
    await invoke("update_widget_geometry", {
      id,
      x: element.offsetLeft,
      y: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    });
  } catch (error) {
    console.error("failed to save widget geometry", error);
    boardLoaded = false;
    await loadBoardWidgets();
  }
}

async function removeBoardWidget(id: number): Promise<void> {
  try {
    await invoke("delete_widget", { id });
    boardWidgets = boardWidgets.filter((widget) => widget.id !== id);
    renderBoard();
  } catch (error) {
    console.error("failed to delete widget", error);
  }
}

async function saveGlobalShortcut(shortcut: string): Promise<void> {
  try {
    shellStatus = await invoke<ShellStatus>("set_global_shortcut", { shortcut });
    shortcutFormError = null;
    shortcutPopoverOpen = false;
    render();
  } catch (error) {
    shortcutFormError = getErrorMessage(error);
    if (currentView === "board") {
      renderBoard();
    }
  }
}

async function transitionView(event: ViewEvent): Promise<void> {
  try {
    currentView = await invoke<ViewState>("transition_view", { event });
    render();
  } catch (error) {
    console.error("view transition failed", error);
  }
}

async function openContent(url: string): Promise<void> {
  try {
    currentView = await invoke<ViewState>("open_content", { url });
    render();
  } catch (error) {
    console.error("content launch failed", error);
  }
}

async function boot(): Promise<void> {
  await listen<ViewState>("view-state-changed", (event) => {
    currentView = event.payload;
    render();
  });

  await listen<ShellStatus>("shell-status-changed", (event) => {
    shellStatus = event.payload;
    render();
  });

  try {
    currentView = await invoke<ViewState>("get_view_state");
  } catch (error) {
    console.error("failed to read initial view state", error);
  }

  try {
    shellStatus = await invoke<ShellStatus>("get_shell_status");
  } catch (error) {
    console.error("failed to read shell status", error);
  }

  render();
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

void boot();
