import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";
import "./cache-ui.css";

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

type CacheChanged = {
  sourceKind: string;
  sourceConfigJson: string;
  widgetIds: number[];
};

type Point = { x: number; y: number };

type SourceGroup = {
  sourceKind: string;
  sourceConfigJson: string;
  widgetIds: number[];
};

type ArxivSourceConfig = {
  query: string;
  maxResults: number;
};

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
const COMPACT_CACHE_LIMIT = 3;
const BOARD_CACHE_LIMIT = 3;
const REFRESH_SLIDER_MAX = 100;
const MIN_AUTO_REFRESH_SECONDS = 5 * 60;
const MAX_AUTO_REFRESH_SECONDS = 24 * 60 * 60;
const DEFAULT_ARXIV_QUERY = "cat:cs.AI";
const DEFAULT_ARXIV_MAX_RESULTS = 12;

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
let boardHydrationGeneration = 0;
let addPoint: Point | null = null;
let shortcutPopoverOpen = false;
let shortcutFormError: string | null = null;
let refreshPopoverOpen = false;
let refreshSettings: RefreshSettings | null = null;
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

  root.innerHTML = `
    <main class="compact-shell" aria-label="Quick discovery">
      <header class="compact-toolbar">
        <span class="compact-mark" aria-hidden="true"></span>
        <span class="compact-title">dopagaki</span>
        ${shortcutWarning}
        <button class="icon-button" data-action="board" type="button" aria-label="Open Board">▦</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle">×</button>
      </header>
      <section class="compact-feed" data-count="0" aria-label="Cached discovery items"></section>
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

  void loadCompactItems();
}

async function loadCompactItems(showLoading = true): Promise<void> {
  const feed = document.querySelector<HTMLElement>(".compact-feed");
  if (!feed) {
    return;
  }

  if (showLoading) {
    feed.setAttribute("aria-busy", "true");
    feed.replaceChildren(createStatusElement("Loading cached content…"));
  }

  try {
    const items = await invoke<CachedItem[]>("list_cached_items", { limit: COMPACT_CACHE_LIMIT });
    if (currentView !== "compact" || !feed.isConnected) {
      return;
    }

    renderCompactItems(feed, items);
    feed.removeAttribute("aria-busy");

    if (items.length > 0) {
      const previous = shellStatus;
      shellStatus = await invoke<ShellStatus>("mark_cached_items_seen", {
        ids: items.map((item) => item.id),
      });
      applyShellStatusToVisibleUi(previous);
    }
  } catch (error) {
    if (currentView === "compact" && feed.isConnected && showLoading) {
      feed.dataset.count = "0";
      feed.removeAttribute("aria-busy");
      feed.replaceChildren(createStatusElement("Cached content is unavailable."));
    }
    console.error("failed to load compact cache", error);
  }
}

function renderCompactItems(feed: HTMLElement, items: CachedItem[]): void {
  feed.dataset.count = String(items.length);
  feed.replaceChildren();

  if (items.length === 0) {
    feed.append(createStatusElement("Nothing cached yet."));
    return;
  }

  for (const item of items) {
    feed.append(createCompactItem(item));
  }
}

function createCompactItem(item: CachedItem): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `content-card content-card--cached content-card--${item.sourceKind}`;
  button.setAttribute("aria-label", `${sourceLabel(item.sourceKind)}: ${item.title ?? "Open content"}`);

  if (item.imageUrl) {
    button.classList.add("content-card--has-image");
    const image = document.createElement("img");
    image.className = "content-card__image";
    image.alt = "";
    image.decoding = "async";
    image.src = item.imageUrl;
    image.addEventListener("error", () => {
      image.remove();
      button.classList.remove("content-card--has-image");
    });
    button.append(image);
  }

  const source = document.createElement("span");
  source.className = "content-card__source";
  source.textContent = sourceLabel(item.sourceKind);
  button.append(source);

  const body = document.createElement("span");
  body.className = "content-card__body";

  const title = document.createElement("strong");
  title.className = "content-card__title";
  title.textContent = item.title ?? sourceLabel(item.sourceKind);
  body.append(title);

  if (item.author) {
    const meta = document.createElement("span");
    meta.className = "content-card__meta";
    meta.textContent = item.author;
    body.append(meta);
  }

  button.append(body);
  button.addEventListener("click", () => {
    void openContent(item.externalUrl);
  });
  return button;
}

function renderBoard(): void {
  const generation = ++boardHydrationGeneration;
  const widgetMarkup = boardWidgets.map(renderWidgetMarkup).join("");
  const pickerMarkup = addPoint ? renderAddPickerMarkup(addPoint) : "";
  const shortcutPopoverMarkup = shortcutPopoverOpen ? renderShortcutPopoverMarkup() : "";
  const refreshPopoverMarkup = refreshPopoverOpen ? renderRefreshPopoverMarkup() : "";

  root.innerHTML = `
    <main class="board-shell">
      <header class="board-toolbar">
        <strong>Board</strong>
        <span class="board-toolbar__hint">Click empty space to add · drag to move</span>
        <button class="icon-button" data-action="refresh-settings" type="button" aria-label="Refresh settings">↻</button>
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
  void hydrateBoardWidgets(generation);

  if (!boardLoaded) {
    boardLoaded = true;
    void loadBoardWidgets();
  }
}

function renderWidgetMarkup(widget: WidgetLayout): string {
  const label = sourceLabel(widget.sourceKind);
  const configButton =
    widget.sourceKind === "arxiv"
      ? `<button class="board-widget__config" data-config-widget type="button" aria-label="Configure ${label}" title="Source settings">•••</button>`
      : "";
  const refreshButton =
    widget.sourceKind === "arxiv"
      ? `<button class="board-widget__refresh" data-refresh-widget type="button" aria-label="Refresh ${label}" title="Refresh now">↻</button>`
      : "";
  return `
    <article
      class="board-widget board-widget--${widget.sourceKind}"
      data-widget-id="${widget.id}"
      style="left:${widget.x}px;top:${widget.y}px;width:${widget.width}px;height:${widget.height}px"
    >
      <div class="board-widget__drag" data-drag-handle>
        <span>${label}</span>
        ${configButton}
        ${refreshButton}
        <button class="board-widget__delete" data-delete-widget type="button" aria-label="Delete ${label}">×</button>
      </div>
      <div class="board-widget__content" data-widget-content aria-label="${label} cached content">
        <span class="board-widget__empty">Loading cache…</span>
      </div>
      <button class="board-widget__resize" data-resize-handle type="button" aria-label="Resize ${label}"></button>
    </article>
  `;
}

async function hydrateBoardWidgets(generation: number): Promise<void> {
  if (boardWidgets.length === 0) {
    return;
  }

  const groups = new Map<string, SourceGroup>();
  for (const widget of boardWidgets) {
    const key = JSON.stringify([widget.sourceKind, widget.sourceConfigJson]);
    const existing = groups.get(key);
    if (existing) {
      existing.widgetIds.push(widget.id);
    } else {
      groups.set(key, {
        sourceKind: widget.sourceKind,
        sourceConfigJson: widget.sourceConfigJson,
        widgetIds: [widget.id],
      });
    }
  }

  await Promise.all([...groups.values()].map((group) => hydrateBoardSource(group, generation)));
}

async function hydrateBoardSource(group: SourceGroup, generation: number): Promise<void> {
  try {
    const items = await invoke<CachedItem[]>("list_cached_items_for_source", {
      sourceKind: group.sourceKind,
      sourceConfigJson: group.sourceConfigJson,
      limit: BOARD_CACHE_LIMIT,
    });
    if (currentView !== "board" || generation !== boardHydrationGeneration) {
      return;
    }

    for (const widgetId of group.widgetIds) {
      const container = document.querySelector<HTMLElement>(
        `[data-widget-id="${widgetId}"] [data-widget-content]`,
      );
      if (container?.isConnected) {
        renderBoardCachedItems(container, items, group.sourceKind);
      }
    }
  } catch (error) {
    if (currentView === "board" && generation === boardHydrationGeneration) {
      for (const widgetId of group.widgetIds) {
        const container = document.querySelector<HTMLElement>(
          `[data-widget-id="${widgetId}"] [data-widget-content]`,
        );
        if (container?.isConnected) {
          container.replaceChildren(createBoardEmpty("Cache unavailable"));
        }
      }
    }
    console.error(`failed to hydrate ${group.sourceKind} widget cache`, error);
  }
}

function renderBoardCachedItems(
  container: HTMLElement,
  items: CachedItem[],
  sourceKind: string,
): void {
  container.replaceChildren();
  if (items.length === 0) {
    container.append(createBoardEmpty(`No cached ${sourceLabel(sourceKind)} items`));
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-feed-item";
    button.setAttribute("aria-label", item.title ?? `Open ${sourceLabel(item.sourceKind)}`);

    if (item.imageUrl) {
      const image = document.createElement("img");
      image.className = "board-feed-item__image";
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.src = item.imageUrl;
      image.addEventListener("error", () => image.remove());
      button.append(image);
    }

    const text = document.createElement("span");
    text.className = "board-feed-item__text";

    const title = document.createElement("span");
    title.className = "board-feed-item__title";
    title.textContent = item.title ?? sourceLabel(item.sourceKind);
    text.append(title);

    const metaText = item.author ?? (item.sourceKind !== sourceKind ? sourceLabel(item.sourceKind) : null);
    if (metaText) {
      const meta = document.createElement("span");
      meta.className = "board-feed-item__meta";
      meta.textContent = metaText;
      text.append(meta);
    }

    button.append(text);
    button.addEventListener("click", () => {
      void openContent(item.externalUrl);
    });
    container.append(button);
  }
}

function createBoardEmpty(message: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "board-widget__empty";
  element.textContent = message;
  return element;
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

function renderRefreshPopoverMarkup(): string {
  return `
    <aside class="refresh-popover" aria-label="Automatic refresh settings">
      <div class="refresh-popover__header">
        <strong>Auto refresh</strong>
        <button data-action="close-refresh-settings" type="button" aria-label="Close refresh settings">×</button>
      </div>
      <label class="refresh-popover__control" for="refresh-interval">
        <input id="refresh-interval" type="range" min="0" max="${REFRESH_SLIDER_MAX}" step="1">
        <output id="refresh-interval-output" for="refresh-interval">Loading…</output>
      </label>
      <p class="refresh-popover__help">Left edge is OFF. The rest scales from 5 min to 24 h, with more room for short intervals.</p>
      <p id="refresh-error" class="refresh-popover__error" hidden></p>
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

  const slider = document.querySelector<HTMLInputElement>("#refresh-interval");
  const output = document.querySelector<HTMLOutputElement>("#refresh-interval-output");
  const errorElement = document.querySelector<HTMLElement>("#refresh-error");
  if (!slider || !output || !errorElement) {
    return;
  }

  document.querySelector('[data-action="close-refresh-settings"]')?.addEventListener("click", () => {
    refreshPopoverOpen = false;
    refreshFormError = null;
    renderBoard();
  });

  slider.addEventListener("input", () => {
    output.value = formatRefreshInterval(sliderPositionToSeconds(Number(slider.value)));
  });

  slider.addEventListener("change", () => {
    void saveAutoRefreshInterval(Number(slider.value), slider, output, errorElement);
  });

  if (refreshSettings) {
    setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
    showRefreshError(errorElement, refreshFormError);
  } else {
    slider.disabled = true;
    output.value = "Loading…";
    void loadRefreshSettings(slider, output, errorElement);
  }
}

async function loadRefreshSettings(
  slider: HTMLInputElement,
  output: HTMLOutputElement,
  errorElement: HTMLElement,
): Promise<void> {
  try {
    refreshSettings = await invoke<RefreshSettings>("get_refresh_settings");
    if (!refreshPopoverOpen || !slider.isConnected) {
      return;
    }
    setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
    slider.disabled = false;
    showRefreshError(errorElement, refreshFormError);
  } catch (error) {
    if (refreshPopoverOpen && slider.isConnected) {
      slider.disabled = true;
      output.value = "Unavailable";
      showRefreshError(errorElement, getErrorMessage(error));
    }
    console.error("failed to load refresh settings", error);
  }
}

async function saveAutoRefreshInterval(
  sliderPosition: number,
  slider: HTMLInputElement,
  output: HTMLOutputElement,
  errorElement: HTMLElement,
): Promise<void> {
  const autoIntervalSeconds = sliderPositionToSeconds(sliderPosition);
  slider.disabled = true;
  refreshFormError = null;
  showRefreshError(errorElement, null);

  try {
    refreshSettings = await invoke<RefreshSettings>("set_auto_refresh_interval", {
      autoIntervalSeconds,
    });
    if (!refreshPopoverOpen || !slider.isConnected) {
      return;
    }
    setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
  } catch (error) {
    refreshFormError = getErrorMessage(error);
    if (refreshPopoverOpen && slider.isConnected) {
      showRefreshError(errorElement, refreshFormError);
      if (refreshSettings) {
        setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
      }
    }
    console.error("failed to save refresh interval", error);
  } finally {
    if (refreshPopoverOpen && slider.isConnected) {
      slider.disabled = false;
    }
  }
}

function setRefreshControls(
  slider: HTMLInputElement,
  output: HTMLOutputElement,
  seconds: number | null,
): void {
  slider.value = String(secondsToSliderPosition(seconds));
  output.value = formatRefreshInterval(seconds);
}

function showRefreshError(element: HTMLElement, message: string | null): void {
  element.textContent = message ?? "";
  element.hidden = !message;
}

function sliderPositionToSeconds(position: number): number | null {
  const normalizedPosition = clamp(Math.round(position), 0, REFRESH_SLIDER_MAX);
  if (normalizedPosition === 0) {
    return null;
  }

  const fraction = (normalizedPosition - 1) / (REFRESH_SLIDER_MAX - 1);
  const rawSeconds =
    MIN_AUTO_REFRESH_SECONDS *
    Math.pow(MAX_AUTO_REFRESH_SECONDS / MIN_AUTO_REFRESH_SECONDS, fraction);
  const roundedToMinute = Math.round(rawSeconds / 60) * 60;
  return clamp(roundedToMinute, MIN_AUTO_REFRESH_SECONDS, MAX_AUTO_REFRESH_SECONDS);
}

function secondsToSliderPosition(seconds: number | null): number {
  if (seconds === null) {
    return 0;
  }

  const bounded = clamp(seconds, MIN_AUTO_REFRESH_SECONDS, MAX_AUTO_REFRESH_SECONDS);
  const fraction =
    Math.log(bounded / MIN_AUTO_REFRESH_SECONDS) /
    Math.log(MAX_AUTO_REFRESH_SECONDS / MIN_AUTO_REFRESH_SECONDS);
  return clamp(Math.round(1 + fraction * (REFRESH_SLIDER_MAX - 1)), 1, REFRESH_SLIDER_MAX);
}

function formatRefreshInterval(seconds: number | null): string {
  if (seconds === null) {
    return "OFF";
  }
  if (seconds < 60 * 60) {
    return `${Math.round(seconds / 60)} min`;
  }

  const hours = seconds / (60 * 60);
  if (hours < 10 && Math.abs(hours - Math.round(hours)) > 0.05) {
    return `${hours.toFixed(1)} h`;
  }
  return `${Math.round(hours)} h`;
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
      if ((event.target as HTMLElement).closest("[data-delete-widget], [data-refresh-widget], [data-config-widget]")) {
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

    element.querySelector<HTMLButtonElement>("[data-config-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      openWidgetConfigEditor(element, id);
    });

    element.querySelector<HTMLButtonElement>("[data-refresh-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      void refreshBoardWidget(id, event.currentTarget as HTMLButtonElement);
    });
  }
}

function openWidgetConfigEditor(element: HTMLElement, id: number): void {
  const widget = boardWidgets.find((item) => item.id === id);
  if (!widget || widget.sourceKind !== "arxiv") {
    return;
  }

  for (const editor of document.querySelectorAll<HTMLElement>("[data-widget-config-editor]")) {
    editor.remove();
  }

  const config = readArxivConfig(widget.sourceConfigJson);
  const form = document.createElement("form");
  form.className = "board-widget-config";
  form.dataset.widgetConfigEditor = "";
  form.setAttribute("aria-label", "arXiv source settings");
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "board-widget-config__header";
  const title = document.createElement("strong");
  title.textContent = "arXiv source";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "board-widget-config__close";
  close.setAttribute("aria-label", "Close source settings");
  close.textContent = "×";
  header.append(title, close);

  const queryLabel = document.createElement("label");
  queryLabel.className = "board-widget-config__field";
  const queryCaption = document.createElement("span");
  queryCaption.textContent = "Query";
  const queryInput = document.createElement("input");
  queryInput.type = "text";
  queryInput.value = config.query;
  queryInput.maxLength = 512;
  queryInput.autocomplete = "off";
  queryInput.spellcheck = false;
  queryInput.placeholder = DEFAULT_ARXIV_QUERY;
  queryLabel.append(queryCaption, queryInput);

  const countLabel = document.createElement("label");
  countLabel.className = "board-widget-config__field board-widget-config__field--count";
  const countCaption = document.createElement("span");
  countCaption.textContent = "Items";
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.max = "25";
  countInput.step = "1";
  countInput.value = String(config.maxResults);
  countLabel.append(countCaption, countInput);

  const help = document.createElement("p");
  help.className = "board-widget-config__help";
  help.textContent = 'Example: cat:cs.AI · ti:"graph neural network"';

  const errorElement = document.createElement("p");
  errorElement.className = "board-widget-config__error";
  errorElement.setAttribute("role", "status");
  errorElement.hidden = true;

  const actions = document.createElement("div");
  actions.className = "board-widget-config__actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Save";
  actions.append(cancel, submit);

  const dismiss = (): void => form.remove();
  close.addEventListener("click", dismiss);
  cancel.addEventListener("click", dismiss);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveWidgetSourceConfig(
      id,
      element,
      form,
      queryInput,
      countInput,
      errorElement,
      submit,
    );
  });

  form.append(header, queryLabel, countLabel, help, errorElement, actions);
  element.append(form);
  queryInput.focus();
  queryInput.select();
}

function readArxivConfig(sourceConfigJson: string): ArxivSourceConfig {
  try {
    const parsed = JSON.parse(sourceConfigJson) as Partial<ArxivSourceConfig>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : DEFAULT_ARXIV_QUERY,
      maxResults:
        typeof parsed.maxResults === "number" && Number.isFinite(parsed.maxResults)
          ? parsed.maxResults
          : DEFAULT_ARXIV_MAX_RESULTS,
    };
  } catch {
    return {
      query: DEFAULT_ARXIV_QUERY,
      maxResults: DEFAULT_ARXIV_MAX_RESULTS,
    };
  }
}

async function saveWidgetSourceConfig(
  id: number,
  element: HTMLElement,
  form: HTMLFormElement,
  queryInput: HTMLInputElement,
  countInput: HTMLInputElement,
  errorElement: HTMLElement,
  submitButton: HTMLButtonElement,
): Promise<void> {
  errorElement.hidden = true;
  errorElement.textContent = "";
  submitButton.disabled = true;
  queryInput.disabled = true;
  countInput.disabled = true;
  form.setAttribute("aria-busy", "true");

  try {
    const updated = await invoke<WidgetLayout>("update_widget_source_config", {
      id,
      sourceConfigJson: JSON.stringify({
        query: queryInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
    });

    const index = boardWidgets.findIndex((widget) => widget.id === id);
    if (index >= 0) {
      boardWidgets[index] = updated;
    }

    form.remove();
    const container = element.querySelector<HTMLElement>("[data-widget-content]");
    if (container?.isConnected) {
      container.replaceChildren(createBoardEmpty("Loading cache…"));
    }

    await hydrateBoardSource(
      {
        sourceKind: updated.sourceKind,
        sourceConfigJson: updated.sourceConfigJson,
        widgetIds: [updated.id],
      },
      boardHydrationGeneration,
    );
  } catch (error) {
    if (form.isConnected) {
      errorElement.textContent = getErrorMessage(error);
      errorElement.hidden = false;
    }
    console.error("failed to save widget source configuration", error);
  } finally {
    if (form.isConnected) {
      submitButton.disabled = false;
      queryInput.disabled = false;
      countInput.disabled = false;
      form.removeAttribute("aria-busy");
    }
  }
}

async function refreshBoardWidget(id: number, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    await invoke("refresh_widget", { id });
  } catch (error) {
    console.error("failed to request widget refresh", error);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
    }
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
    const previousView = currentView;
    currentView = await invoke<ViewState>("open_content", { url });
    if (currentView !== previousView) {
      render();
    }
  } catch (error) {
    console.error("content launch failed", error);
  }
}

function applyShellStatusToVisibleUi(previous: ShellStatus): void {
  if (currentView === "idle") {
    const badge = document.querySelector<HTMLElement>(".idle-orb__badge");
    if (badge) {
      badge.hidden = !shellStatus.hasUnseen;
    }
    return;
  }

  if (
    currentView === "compact" &&
    previous.globalShortcutError !== shellStatus.globalShortcutError
  ) {
    renderCompact();
    return;
  }

  if (currentView === "board" && shortcutPopoverOpen) {
    const input = document.querySelector<HTMLInputElement>("#shortcut-input");
    const errorElement = document.querySelector<HTMLElement>("#shortcut-error");
    if (input && document.activeElement !== input) {
      input.value = shellStatus.globalShortcut;
    }
    if (errorElement) {
      const message = shortcutFormError ?? shellStatus.globalShortcutError;
      errorElement.textContent = message ?? "";
      errorElement.hidden = !message;
    }
  }
}

async function applyCacheChangeToVisibleUi(change: CacheChanged): Promise<void> {
  if (currentView === "compact") {
    await loadCompactItems(false);
    return;
  }

  if (currentView !== "board" || change.widgetIds.length === 0) {
    return;
  }

  const generation = boardHydrationGeneration;
  const activeWidgetIds = change.widgetIds.filter((id) =>
    boardWidgets.some((widget) => widget.id === id),
  );
  if (activeWidgetIds.length === 0) {
    return;
  }

  await hydrateBoardSource(
    {
      sourceKind: change.sourceKind,
      sourceConfigJson: change.sourceConfigJson,
      widgetIds: activeWidgetIds,
    },
    generation,
  );
}

async function boot(): Promise<void> {
  await listen<ViewState>("view-state-changed", (event) => {
    currentView = event.payload;
    render();
  });

  await listen<ShellStatus>("shell-status-changed", (event) => {
    const previous = shellStatus;
    shellStatus = event.payload;
    applyShellStatusToVisibleUi(previous);
  });

  await listen<CacheChanged>("cache-changed", (event) => {
    void applyCacheChangeToVisibleUi(event.payload);
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

function createStatusElement(message: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "feed-status";
  element.textContent = message;
  return element;
}

function sourceLabel(sourceKind: string): string {
  return SOURCE_LABELS[sourceKind] ?? "Source";
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
