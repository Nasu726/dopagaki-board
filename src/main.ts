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

type CachedItem = {
  id: string;
  sourceKind: string;
  sourceConfigJson: string;
  externalUrl: string;
  title: string | null;
  imageUrl: string | null;
  author: string | null;
  publishedAt: number | null;
  fetchedAt: number;
  score: number;
  isUnseen: boolean;
};

type RefreshSettings = {
  autoIntervalSeconds: number | null;
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
const DEFAULT_AUTO_REFRESH_SECONDS = 60 * 60;
const REFRESH_STEP_SECONDS = 5 * 60;
const MAX_REFRESH_STEPS = (24 * 60 * 60) / REFRESH_STEP_SECONDS;
const CACHE_LIMIT = 100;
const COMPACT_ITEM_LIMIT = 3;

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
let refreshSettings: RefreshSettings = {
  autoIntervalSeconds: DEFAULT_AUTO_REFRESH_SECONDS,
};
let cachedItems: CachedItem[] = [];
let cacheLoadPromise: Promise<void> | null = null;
let boardWidgets: WidgetLayout[] = [];
let boardLoaded = false;
let addPoint: Point | null = null;
let shortcutPopoverOpen = false;
let shortcutFormError: string | null = null;
let refreshPopoverOpen = false;
let refreshFormError: string | null = null;

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
  const items = cachedItems.slice(0, COMPACT_ITEM_LIMIT);
  const countClass = `compact-feed--count-${Math.max(1, items.length)}`;
  const feedMarkup = items.length > 0
    ? items.map(renderCompactItemMarkup).join("")
    : `<div class="compact-empty">No cached discoveries yet.</div>`;

  root.innerHTML = `
    <main class="compact-shell" aria-label="Quick discovery">
      <header class="compact-toolbar">
        <span class="compact-mark" aria-hidden="true"></span>
        <span class="compact-title">dopagaki</span>
        ${shortcutWarning}
        <button class="icon-button" data-action="board" type="button" aria-label="Open Board">▦</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle">×</button>
      </header>

      <section class="compact-feed ${countClass}" aria-label="Cached discoveries">
        ${feedMarkup}
      </section>
    </main>
  `;

  document.querySelector('[data-action="board"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = false;
    refreshPopoverOpen = false;
    void transitionView("openBoard");
  });

  document.querySelector('[data-action="shortcut-settings"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = true;
    shortcutFormError = shellStatus.globalShortcutError;
    refreshPopoverOpen = false;
    void transitionView("openBoard");
  });

  document.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
    void transitionView("globalToggle");
  });

  bindContentLinks();
  void markItemsSeen(items);
}

function renderCompactItemMarkup(item: CachedItem): string {
  const label = getSourceLabel(item.sourceKind);
  const title = item.title?.trim() || label;
  const useImage = Boolean(item.imageUrl) && item.sourceKind !== "arxiv";
  const sourceClass = sourceClassName(item.sourceKind);
  const authorMarkup = item.author
    ? `<span class="content-card__author">${escapeHtml(item.author)}</span>`
    : "";
  const imageMarkup = useImage
    ? `<img class="content-card__image" src="${escapeHtml(item.imageUrl ?? "")}" alt="" loading="eager" decoding="async">`
    : "";

  return `
    <button
      class="content-card content-card--${useImage ? "visual" : "text"} content-card--${sourceClass}"
      data-content-item-id="${escapeHtml(item.id)}"
      type="button"
    >
      ${imageMarkup}
      <span class="content-card__source">${escapeHtml(label)}</span>
      <span class="content-card__copy">
        <strong>${escapeHtml(title)}</strong>
        ${authorMarkup}
      </span>
    </button>
  `;
}

function renderBoard(): void {
  const widgetMarkup = boardWidgets.map(renderWidgetMarkup).join("");
  const pickerMarkup = addPoint ? renderAddPickerMarkup(addPoint) : "";
  const shortcutPopoverMarkup = shortcutPopoverOpen ? renderShortcutPopoverMarkup() : "";
  const refreshPopoverMarkup = refreshPopoverOpen ? renderRefreshPopoverMarkup() : "";

  root.innerHTML = `
    <main class="board-shell">
      <header class="board-toolbar">
        <strong>Board</strong>
        <span class="board-toolbar__hint">Click empty space to add · drag to move</span>
        <button class="refresh-control" data-action="refresh-settings" type="button" aria-label="Automatic refresh settings">
          Auto · ${escapeHtml(formatRefreshIntervalShort(refreshSettings.autoIntervalSeconds))}
        </button>
        <button class="icon-button" data-action="shortcut-settings" type="button" aria-label="Global shortcut settings">⌨</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle">×</button>
      </header>
      <section class="board-canvas${boardWidgets.length === 0 ? " board-canvas--empty" : ""}" aria-label="Discovery Board">
        ${widgetMarkup}
        ${pickerMarkup}
      </section>
      ${shortcutPopoverMarkup}
      ${refreshPopoverMarkup}
    </main>
  `;

  document.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = false;
    refreshPopoverOpen = false;
    void transitionView("globalToggle");
  });

  document.querySelector('[data-action="shortcut-settings"]')?.addEventListener("click", () => {
    shortcutPopoverOpen = !shortcutPopoverOpen;
    shortcutFormError = null;
    refreshPopoverOpen = false;
    refreshFormError = null;
    addPoint = null;
    renderBoard();
  });

  document.querySelector('[data-action="refresh-settings"]')?.addEventListener("click", () => {
    refreshPopoverOpen = !refreshPopoverOpen;
    refreshFormError = null;
    shortcutPopoverOpen = false;
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
  bindRefreshPopover();
  bindWidgetInteractions();
  bindContentLinks();

  const visibleItems = boardWidgets
    .map(findCachedItemForWidget)
    .filter((item): item is CachedItem => item !== null);
  void markItemsSeen(visibleItems);

  if (!boardLoaded) {
    boardLoaded = true;
    void loadBoardWidgets();
  }
}

function renderWidgetMarkup(widget: WidgetLayout): string {
  const label = getSourceLabel(widget.sourceKind);
  const item = findCachedItemForWidget(widget);
  const sourceClass = sourceClassName(widget.sourceKind);
  const contentMarkup = item
    ? renderBoardItemMarkup(item)
    : `
      <div class="board-widget__content board-widget__content--empty">
        <span class="board-widget__preview">No cached ${escapeHtml(label)} item yet</span>
      </div>
    `;

  return `
    <article
      class="board-widget board-widget--${sourceClass}"
      data-widget-id="${widget.id}"
      style="left:${widget.x}px;top:${widget.y}px;width:${widget.width}px;height:${widget.height}px"
    >
      <div class="board-widget__drag" data-drag-handle>
        <span>${escapeHtml(label)}</span>
        <button class="board-widget__delete" data-delete-widget type="button" aria-label="Delete ${escapeHtml(label)}">×</button>
      </div>
      ${contentMarkup}
      <button class="board-widget__resize" data-resize-handle type="button" aria-label="Resize ${escapeHtml(label)}"></button>
    </article>
  `;
}

function renderBoardItemMarkup(item: CachedItem): string {
  const title = item.title?.trim() || getSourceLabel(item.sourceKind);
  const useImage = Boolean(item.imageUrl) && item.sourceKind !== "arxiv";
  const imageMarkup = useImage
    ? `<img class="board-widget__image" src="${escapeHtml(item.imageUrl ?? "")}" alt="" loading="lazy" decoding="async">`
    : "";

  return `
    <button
      class="board-widget__content board-widget__content--cached${useImage ? " board-widget__content--visual" : ""}"
      data-content-item-id="${escapeHtml(item.id)}"
      type="button"
      title="Open original content"
    >
      ${imageMarkup}
      <span class="board-widget__item-title">${escapeHtml(title)}</span>
    </button>
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
              `<button data-add-source="${kind}" type="button">${escapeHtml(label)}</button>`,
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

function renderRefreshPopoverMarkup(): string {
  const step = refreshStepFromSeconds(refreshSettings.autoIntervalSeconds);
  return `
    <aside class="refresh-popover" aria-label="Automatic refresh settings">
      <div class="refresh-popover__heading">
        <label for="refresh-range">Automatic refresh</label>
        <output id="refresh-value" for="refresh-range">${escapeHtml(formatRefreshInterval(stepToRefreshSeconds(step)))}</output>
      </div>
      <input id="refresh-range" type="range" min="0" max="${MAX_REFRESH_STEPS}" step="1" value="${step}">
      <div class="refresh-popover__scale" aria-hidden="true"><span>OFF</span><span>24 h</span></div>
      <p>Changes are saved when you release the slider. Manual refresh can remain available when automatic refresh is off.</p>
      <p id="refresh-error" class="refresh-popover__error"${refreshFormError ? "" : " hidden"}>${escapeHtml(refreshFormError ?? "")}</p>
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

function bindRefreshPopover(): void {
  if (!refreshPopoverOpen) {
    return;
  }

  const input = document.querySelector<HTMLInputElement>("#refresh-range");
  const output = document.querySelector<HTMLOutputElement>("#refresh-value");
  const errorElement = document.querySelector<HTMLElement>("#refresh-error");
  if (!input || !output || !errorElement) {
    return;
  }

  input.addEventListener("input", () => {
    const step = clamp(Math.round(input.valueAsNumber), 0, MAX_REFRESH_STEPS);
    output.textContent = formatRefreshInterval(stepToRefreshSeconds(step));
    errorElement.hidden = true;
  });

  input.addEventListener("change", () => {
    const step = clamp(Math.round(input.valueAsNumber), 0, MAX_REFRESH_STEPS);
    void saveAutoRefreshInterval(step);
  });
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
  refreshPopoverOpen = false;
  refreshFormError = null;
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

function bindContentLinks(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-content-item-id]")) {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = element.dataset.contentItemId;
      const item = id ? cachedItems.find((candidate) => candidate.id === id) : undefined;
      if (item) {
        void openContent(item.externalUrl);
      }
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

function findCachedItemForWidget(widget: WidgetLayout): CachedItem | null {
  return cachedItems.find(
    (item) =>
      item.sourceKind === widget.sourceKind && item.sourceConfigJson === widget.sourceConfigJson,
  ) ?? null;
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

async function loadCachedItems(): Promise<void> {
  if (cacheLoadPromise) {
    return cacheLoadPromise;
  }

  cacheLoadPromise = (async () => {
    try {
      cachedItems = await invoke<CachedItem[]>("list_cached_items", { limit: CACHE_LIMIT });
      if (currentView === "compact") {
        renderCompact();
      } else if (currentView === "board") {
        renderBoard();
      }
    } catch (error) {
      console.error("failed to load cached items", error);
    } finally {
      cacheLoadPromise = null;
    }
  })();

  return cacheLoadPromise;
}

async function markItemsSeen(items: CachedItem[]): Promise<void> {
  const unseenItems = items.filter((item) => item.isUnseen);
  if (unseenItems.length === 0) {
    return;
  }

  for (const item of unseenItems) {
    item.isUnseen = false;
  }

  try {
    const next = await invoke<ShellStatus>("mark_cached_items_seen", {
      ids: unseenItems.map((item) => item.id),
    });
    applyShellStatus(next);
  } catch (error) {
    for (const item of unseenItems) {
      item.isUnseen = true;
    }
    console.error("failed to mark cached items seen", error);
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

async function saveAutoRefreshInterval(step: number): Promise<void> {
  const autoIntervalSeconds = stepToRefreshSeconds(step);
  try {
    refreshSettings = await invoke<RefreshSettings>("set_auto_refresh_interval", {
      autoIntervalSeconds,
    });
    refreshFormError = null;

    const output = document.querySelector<HTMLOutputElement>("#refresh-value");
    if (output) {
      output.textContent = formatRefreshInterval(refreshSettings.autoIntervalSeconds);
    }
    const button = document.querySelector<HTMLButtonElement>('[data-action="refresh-settings"]');
    if (button) {
      button.textContent = `Auto · ${formatRefreshIntervalShort(refreshSettings.autoIntervalSeconds)}`;
    }
  } catch (error) {
    refreshFormError = getErrorMessage(error);
    if (currentView === "board") {
      renderBoard();
    }
  }
}

async function transitionView(event: ViewEvent): Promise<void> {
  try {
    currentView = await invoke<ViewState>("transition_view", { event });
    render();
    if (currentView === "compact" || currentView === "board") {
      void loadCachedItems();
    }
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
    if (currentView === "compact" || currentView === "board") {
      void loadCachedItems();
    }
  });

  await listen<ShellStatus>("shell-status-changed", (event) => {
    applyShellStatus(event.payload);
  });

  const [viewResult, shellResult, cacheResult, refreshResult] = await Promise.allSettled([
    invoke<ViewState>("get_view_state"),
    invoke<ShellStatus>("get_shell_status"),
    invoke<CachedItem[]>("list_cached_items", { limit: CACHE_LIMIT }),
    invoke<RefreshSettings>("get_refresh_settings"),
  ]);

  if (viewResult.status === "fulfilled") {
    currentView = viewResult.value;
  } else {
    console.error("failed to read initial view state", viewResult.reason);
  }

  if (shellResult.status === "fulfilled") {
    shellStatus = shellResult.value;
  } else {
    console.error("failed to read shell status", shellResult.reason);
  }

  if (cacheResult.status === "fulfilled") {
    cachedItems = cacheResult.value;
  } else {
    console.error("failed to read cached items", cacheResult.reason);
  }

  if (refreshResult.status === "fulfilled") {
    refreshSettings = refreshResult.value;
  } else {
    console.error("failed to read refresh settings", refreshResult.reason);
  }

  render();
}

function applyShellStatus(next: ShellStatus): void {
  const shortcutChanged =
    shellStatus.globalShortcut !== next.globalShortcut ||
    shellStatus.globalShortcutError !== next.globalShortcutError;
  shellStatus = next;

  if (currentView === "idle") {
    const badge = document.querySelector<HTMLElement>(".idle-orb__badge");
    if (badge) {
      badge.hidden = !shellStatus.hasUnseen;
    }
    return;
  }

  if (shortcutChanged && currentView === "compact") {
    renderCompact();
  } else if (shortcutChanged && currentView === "board" && shortcutPopoverOpen) {
    renderBoard();
  }
}

function refreshStepFromSeconds(seconds: number | null): number {
  if (seconds === null) {
    return 0;
  }
  return clamp(Math.round(seconds / REFRESH_STEP_SECONDS), 1, MAX_REFRESH_STEPS);
}

function stepToRefreshSeconds(step: number): number | null {
  if (step <= 0) {
    return null;
  }
  return clamp(Math.round(step), 1, MAX_REFRESH_STEPS) * REFRESH_STEP_SECONDS;
}

function formatRefreshInterval(seconds: number | null): string {
  if (seconds === null) {
    return "OFF";
  }
  if (seconds < 60 * 60) {
    return `${Math.round(seconds / 60)} min`;
  }

  const hours = Math.floor(seconds / (60 * 60));
  const minutes = Math.round((seconds % (60 * 60)) / 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function formatRefreshIntervalShort(seconds: number | null): string {
  if (seconds === null) {
    return "OFF";
  }
  if (seconds < 60 * 60) {
    return `${Math.round(seconds / 60)}m`;
  }

  const hours = seconds / (60 * 60);
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function getSourceLabel(sourceKind: string): string {
  return SOURCE_LABELS[sourceKind] ?? sourceKind;
}

function sourceClassName(sourceKind: string): string {
  const safe = sourceKind.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return safe || "generic";
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
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
