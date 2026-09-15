import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_WIDGET_COLUMNS,
  DEFAULT_WIDGET_ROWS,
  GRID_COLUMNS,
  GRID_ROWS,
  type GridRect,
  type ResizeDirection,
  clampGridRect,
  collides,
  findNearestFreeRect,
  isValidGridRect,
  legacyPixelsToGrid,
  pointToGridCell,
  pointerDeltaToGrid,
  rectToStyle,
  resizeGridRect,
} from "./board-grid";
import {
  DEFAULT_AUTO_REFRESH_SECONDS,
  MAX_AUTO_REFRESH_SECONDS,
  MIN_AUTO_REFRESH_SECONDS,
  REFRESH_SLIDER_MAX,
  formatRefreshInterval,
  normalizeRefreshSeconds,
  refreshMinutesToSeconds,
  secondsToSliderPosition,
  sliderPositionToSeconds,
  sourceAutoRefreshFloorSeconds,
} from "./refresh-controls";
import {
  closeOpenWidgetSettings,
  openWidgetSettings,
  type WidgetSettingsSaveInput,
} from "./widget-settings";
import "./styles.css";
import "./cache-ui.css";
import "./board-mode.css";
import "./refresh-settings-exact.css";

type ViewState = "hidden" | "idle" | "compact" | "board";
type ViewEvent =
  | "globalToggle"
  | "clickIdleOrb"
  | "openCompact"
  | "openBoard"
  | "hide";
type BoardMode = "select" | "add";

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

type RefreshMode = "inherit" | "off" | "interval";

type SourceRefreshDefault = {
  sourceKind: string;
  mode: RefreshMode;
  autoIntervalSeconds: number | null;
  effectiveIntervalSeconds: number | null;
};

type CacheChanged = {
  sourceKind: string;
  sourceConfigJson: string;
  widgetIds: number[];
};

type GridPoint = { x: number; y: number };

type SourceGroup = {
  sourceKind: string;
  sourceConfigJson: string;
  widgetIds: number[];
};

const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  arxiv: "arXiv",
  wikipedia: "Wikipedia",
  qiita: "Qiita",
  zenn: "Zenn",
};

const ADDABLE_SOURCE_KINDS = ["arxiv", "wikipedia", "qiita", "zenn", "youtube"] as const;
const DEFAULT_GLOBAL_SHORTCUT = "CmdOrCtrl+Shift+Space";
const COMPACT_CACHE_LIMIT = 3;
const BOARD_CACHE_LIMIT = 25;

function getAppRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) {
    throw new Error("#app root was not found");
  }
  return element;
}

const root = getAppRoot();
let currentView: ViewState = "idle";
let boardMode: BoardMode = "select";
let shellStatus: ShellStatus = {
  hasUnseen: false,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutError: null,
};
let boardWidgets: WidgetLayout[] = [];
let boardLoaded = false;
let boardHydrationGeneration = 0;
let addPoint: GridPoint | null = null;
let settingsOpen = false;
let shortcutFormError: string | null = null;
let refreshSettings: RefreshSettings | null = null;
let refreshFormError: string | null = null;
let sourceRefreshDefaults: SourceRefreshDefault[] | null = null;
let sourceRefreshFormError: string | null = null;

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
      <button id="idle-orb" class="idle-orb" type="button" aria-label="Restore dopagaki-board" title="Restore">
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
    ? `<button class="shortcut-warning" data-action="settings" type="button">Shortcut unavailable</button>`
    : "";

  root.innerHTML = `
    <main class="compact-shell" aria-label="Quick discovery">
      <header class="compact-toolbar">
        <div class="window-drag-region" data-tauri-drag-region title="Drag window">
          <span class="compact-mark" aria-hidden="true" data-tauri-drag-region></span>
          <span class="compact-title" data-tauri-drag-region>dopagaki</span>
        </div>
        ${shortcutWarning}
        <button class="icon-button" data-action="board" type="button" aria-label="Open Board" title="Maximize to Board">□</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle" title="Minimize to Idle">—</button>
      </header>
      <section class="compact-feed" data-count="0" aria-label="Cached discovery items"></section>
    </main>
  `;

  document.querySelector('[data-action="board"]')?.addEventListener("click", () => {
    settingsOpen = false;
    void transitionView("openBoard");
  });

  document.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
    settingsOpen = true;
    shortcutFormError = shellStatus.globalShortcutError;
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
    const items = await invoke<CachedItem[]>("list_compact_items", {
      limit: COMPACT_CACHE_LIMIT,
    });
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
  const pickerMarkup = boardMode === "add" && addPoint ? renderAddPickerMarkup(addPoint) : "";
  const settingsMarkup = settingsOpen ? renderSettingsMarkup() : "";
  const boardHint = boardMode === "select"
    ? "Drag widgets to move · resize from edges"
    : "Click empty space to place a source";

  root.innerHTML = `
    <main class="board-shell">
      <header class="board-toolbar">
        <div class="window-drag-region" data-tauri-drag-region title="Drag window">
          <strong data-tauri-drag-region>Board</strong>
          <span class="board-toolbar__hint" data-board-mode-hint data-tauri-drag-region>${boardHint}</span>
        </div>
        <div class="board-mode-switch" role="group" aria-label="Board mode">
          <button class="board-mode-button" data-board-mode="select" type="button" aria-pressed="${boardMode === "select"}">Select</button>
          <button class="board-mode-button" data-board-mode="add" type="button" aria-pressed="${boardMode === "add"}">Add</button>
        </div>
        <button class="icon-button" data-action="settings" type="button" aria-label="Settings" title="Settings">⚙</button>
        <button class="icon-button" data-action="restore" type="button" aria-label="Restore Compact" title="Restore down to Compact">▱</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle" title="Minimize to Idle">—</button>
      </header>
      <section class="board-canvas board-canvas--${boardMode}${boardWidgets.length === 0 ? " board-canvas--empty" : ""}" aria-label="Discovery Board">
        ${widgetMarkup}
        ${pickerMarkup}
      </section>
      ${settingsMarkup}
    </main>
  `;

  document.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
    settingsOpen = false;
    void transitionView("globalToggle");
  });

  document.querySelector('[data-action="restore"]')?.addEventListener("click", () => {
    settingsOpen = false;
    void transitionView("openCompact");
  });

  document.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
    toggleBoardSettings();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-board-mode]")) {
    button.addEventListener("click", () => {
      const mode = button.dataset.boardMode;
      if (mode === "select" || mode === "add") {
        setBoardMode(mode);
      }
    });
  }

  const canvas = document.querySelector<HTMLElement>(".board-canvas");
  canvas?.addEventListener("pointerdown", handleBoardPointerDown);

  bindAddPicker();
  bindSettings();
  bindWidgetInteractions();
  void hydrateBoardWidgets(generation);

  if (!boardLoaded) {
    boardLoaded = true;
    void loadBoardWidgets();
  }
}

function toggleBoardSettings(): void {
  boardMode = "select";
  addPoint = null;
  closeOpenWidgetSettings();
  document.querySelector(".add-picker")?.remove();
  applyBoardModeToVisibleUi();

  if (settingsOpen) {
    closeBoardSettings();
    return;
  }

  settingsOpen = true;
  shortcutFormError = null;
  refreshFormError = null;
  sourceRefreshFormError = null;
  showBoardSettings();
}

function showBoardSettings(): void {
  if (!settingsOpen || currentView !== "board") {
    return;
  }
  if (document.querySelector(".settings-popover")) {
    return;
  }

  const shell = document.querySelector<HTMLElement>(".board-shell");
  if (!shell) {
    return;
  }
  shell.insertAdjacentHTML("beforeend", renderSettingsMarkup());
  bindSettings();
}

function closeBoardSettings(): void {
  settingsOpen = false;
  shortcutFormError = null;
  refreshFormError = null;
  sourceRefreshFormError = null;
  document.querySelector(".settings-popover")?.remove();
}

function setBoardMode(mode: BoardMode): void {
  boardMode = mode;
  addPoint = null;
  settingsOpen = false;
  closeOpenWidgetSettings();
  document.querySelector(".add-picker")?.remove();
  document.querySelector(".settings-popover")?.remove();
  applyBoardModeToVisibleUi();
}

function resetBoardMode(): void {
  boardMode = "select";
  addPoint = null;
}

function applyBoardModeToVisibleUi(): void {
  if (currentView !== "board") {
    return;
  }

  const canvas = document.querySelector<HTMLElement>(".board-canvas");
  canvas?.classList.toggle("board-canvas--select", boardMode === "select");
  canvas?.classList.toggle("board-canvas--add", boardMode === "add");

  const hint = document.querySelector<HTMLElement>("[data-board-mode-hint]");
  if (hint) {
    hint.textContent = boardMode === "select"
      ? "Drag widgets to move · resize from edges"
      : "Click empty space to place a source";
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-board-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.boardMode === boardMode));
  }
}

function renderWidgetMarkup(widget: WidgetLayout): string {
  const label = sourceLabel(widget.sourceKind);
  const configurable =
    widget.sourceKind === "arxiv" ||
    widget.sourceKind === "wikipedia" ||
    widget.sourceKind === "qiita" ||
    widget.sourceKind === "zenn" ||
    widget.sourceKind === "youtube";
  const configButton = configurable
    ? `<button class="board-widget__config" data-config-widget type="button" aria-label="Configure ${label}" title="Widget settings">•••</button>`
    : "";
  const refreshButton = configurable
    ? `<button class="board-widget__refresh" data-refresh-widget type="button" aria-label="Refresh ${label}" title="Refresh now">↻</button>`
    : "";
  const handles: ResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const resizeMarkup = handles
    .map(
      (direction) =>
        `<button class="board-widget__resize board-widget__resize--${direction}" data-resize-handle="${direction}" type="button" aria-label="Resize ${label} from ${direction}"></button>`,
    )
    .join("");

  return `
    <article
      class="board-widget board-widget--${widget.sourceKind}"
      data-widget-id="${widget.id}"
      style="${rectToStyle(widgetRect(widget))}"
    >
      <div class="board-widget__drag" data-drag-handle>
        <span>${label}</span>
        ${configButton}
        ${refreshButton}
        <button class="board-widget__delete" data-delete-widget type="button" aria-label="Delete ${label}" title="Delete widget">×</button>
      </div>
      <div class="board-widget__content" data-widget-content aria-label="${label} cached content">
        <span class="board-widget__empty">Loading cache…</span>
      </div>
      ${resizeMarkup}
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
      if (boardMode === "select") {
        void openContent(item.externalUrl);
      }
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

function renderAddPickerMarkup(point: GridPoint): string {
  const left = (point.x / GRID_COLUMNS) * 100;
  const top = (point.y / GRID_ROWS) * 100;
  return `
    <aside class="add-picker" style="left:${left}%;top:${top}%" aria-label="Add widget">
      <div class="add-picker__header">
        <strong>Add</strong>
        <button data-action="cancel-add" type="button" aria-label="Cancel">×</button>
      </div>
      <div class="add-picker__sources">
        ${ADDABLE_SOURCE_KINDS.map(
          (kind) => `<button data-add-source="${kind}" type="button">${sourceLabel(kind)}</button>`,
        ).join("")}
      </div>
      <p class="add-picker__note">Only working source adapters are shown.</p>
    </aside>
  `;
}

function bindAddPicker(): void {
  const picker = document.querySelector<HTMLElement>(".add-picker");
  if (!picker) {
    return;
  }

  for (const button of picker.querySelectorAll<HTMLButtonElement>("[data-add-source]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const sourceKind = button.dataset.addSource;
      if (boardMode === "add" && sourceKind && addPoint) {
        void addBoardWidget(sourceKind, addPoint);
      }
    });
  }

  picker.querySelector<HTMLButtonElement>('[data-action="cancel-add"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    setBoardMode("select");
  });
}

function showAddPicker(point: GridPoint): void {
  if (currentView !== "board" || boardMode !== "add") {
    return;
  }
  const canvas = document.querySelector<HTMLElement>(".board-canvas");
  if (!canvas) {
    return;
  }

  canvas.querySelector(".add-picker")?.remove();
  canvas.insertAdjacentHTML("beforeend", renderAddPickerMarkup(point));
  bindAddPicker();
}

function renderSettingsMarkup(): string {
  return `
    <aside class="settings-popover" aria-label="Settings">
      <div class="settings-popover__header">
        <strong>Settings</strong>
        <button data-action="close-settings" type="button" aria-label="Close settings">×</button>
      </div>
      <form id="shortcut-form" class="settings-section">
        <label for="shortcut-input">Global shortcut</label>
        <input id="shortcut-input" type="text" autocomplete="off" spellcheck="false" aria-describedby="shortcut-help shortcut-error">
        <p id="shortcut-help">Example: CmdOrCtrl+Shift+Space</p>
        <p id="shortcut-error" class="settings-error" hidden></p>
        <div class="settings-actions">
          <button type="submit">Save shortcut</button>
        </div>
      </form>
      <section class="settings-section" aria-label="Automatic refresh">
        <label for="refresh-interval">Default automatic refresh</label>
        <div class="settings-range-row settings-range-row--exact">
          <input id="refresh-interval" type="range" min="0" max="${REFRESH_SLIDER_MAX}" step="1">
          <label class="settings-exact-minutes" for="refresh-minutes">
            <input id="refresh-minutes" type="number" min="${MIN_AUTO_REFRESH_SECONDS / 60}" max="${MAX_AUTO_REFRESH_SECONDS / 60}" step="1" inputmode="numeric" aria-label="Default automatic refresh in minutes">
            <span>min</span>
          </label>
          <output id="refresh-interval-output" for="refresh-interval refresh-minutes">Loading…</output>
        </div>
        <p>Use the slider or enter exact minutes. Move the slider to the left edge to turn automatic refresh off.</p>
        <p id="refresh-error" class="settings-error" hidden></p>
      </section>
      <section class="settings-section" aria-label="Source refresh defaults">
        <label>Source refresh</label>
        <div id="source-refresh-defaults" class="settings-source-list" aria-live="polite">Loading…</div>
        <p>Each source can use the default, turn automatic refresh off, or choose an exact interval. Source minimum intervals still apply.</p>
        <p id="source-refresh-error" class="settings-error" hidden></p>
      </section>
    </aside>
  `;
}

function bindSettings(): void {
  if (!settingsOpen) {
    return;
  }

  document.querySelector('[data-action="close-settings"]')?.addEventListener("click", () => {
    closeBoardSettings();
  });

  const shortcutInput = document.querySelector<HTMLInputElement>("#shortcut-input");
  const shortcutForm = document.querySelector<HTMLFormElement>("#shortcut-form");
  const shortcutError = document.querySelector<HTMLElement>("#shortcut-error");
  if (shortcutInput && shortcutForm && shortcutError) {
    shortcutInput.value = shellStatus.globalShortcut;
    showSettingsError(shortcutError, shortcutFormError ?? shellStatus.globalShortcutError);
    shortcutForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveGlobalShortcut(shortcutInput.value);
    });
  }

  const slider = document.querySelector<HTMLInputElement>("#refresh-interval");
  const minutesInput = document.querySelector<HTMLInputElement>("#refresh-minutes");
  const output = document.querySelector<HTMLOutputElement>("#refresh-interval-output");
  const refreshError = document.querySelector<HTMLElement>("#refresh-error");
  if (slider && minutesInput && output && refreshError) {
    slider.addEventListener("input", () => {
      const seconds = sliderPositionToSeconds(Number(slider.value));
      setRefreshExactDisplay(minutesInput, output, seconds);
    });
    slider.addEventListener("change", () => {
      void saveAutoRefreshInterval(
        sliderPositionToSeconds(Number(slider.value)),
        slider,
        minutesInput,
        output,
        refreshError,
      );
    });
    minutesInput.addEventListener("input", () => {
      if (minutesInput.value === "") {
        return;
      }
      const minutes = Number(minutesInput.value);
      if (!Number.isFinite(minutes)) {
        return;
      }
      const seconds = refreshMinutesToSeconds(minutes, MIN_AUTO_REFRESH_SECONDS);
      slider.value = String(secondsToSliderPosition(seconds));
      output.value = formatRefreshInterval(seconds);
    });
    minutesInput.addEventListener("change", () => {
      if (minutesInput.value === "") {
        setRefreshControls(
          slider,
          minutesInput,
          output,
          refreshSettings?.autoIntervalSeconds ?? null,
        );
        return;
      }
      const minutes = Number(minutesInput.value);
      if (!Number.isFinite(minutes)) {
        setRefreshControls(
          slider,
          minutesInput,
          output,
          refreshSettings?.autoIntervalSeconds ?? null,
        );
        return;
      }
      const seconds = refreshMinutesToSeconds(minutes, MIN_AUTO_REFRESH_SECONDS);
      setRefreshControls(slider, minutesInput, output, seconds);
      void saveAutoRefreshInterval(seconds, slider, minutesInput, output, refreshError);
    });

    if (refreshSettings) {
      setRefreshControls(slider, minutesInput, output, refreshSettings.autoIntervalSeconds);
      showSettingsError(refreshError, refreshFormError);
    } else {
      slider.disabled = true;
      minutesInput.disabled = true;
      output.value = "Loading…";
      void loadRefreshSettings(slider, minutesInput, output, refreshError);
    }
  }

  bindSourceRefreshDefaults();
}

async function loadRefreshSettings(
  slider: HTMLInputElement,
  minutesInput: HTMLInputElement,
  output: HTMLOutputElement,
  errorElement: HTMLElement,
): Promise<void> {
  try {
    refreshSettings = await invoke<RefreshSettings>("get_refresh_settings");
    if (!settingsOpen || !slider.isConnected) {
      return;
    }
    setRefreshControls(slider, minutesInput, output, refreshSettings.autoIntervalSeconds);
    slider.disabled = false;
    minutesInput.disabled = false;
    showSettingsError(errorElement, refreshFormError);
  } catch (error) {
    if (settingsOpen && slider.isConnected) {
      slider.disabled = true;
      minutesInput.disabled = true;
      output.value = "Unavailable";
      showSettingsError(errorElement, getErrorMessage(error));
    }
    console.error("failed to load refresh settings", error);
  }
}

async function saveAutoRefreshInterval(
  autoIntervalSeconds: number | null,
  slider: HTMLInputElement,
  minutesInput: HTMLInputElement,
  output: HTMLOutputElement,
  errorElement: HTMLElement,
): Promise<void> {
  slider.disabled = true;
  minutesInput.disabled = true;
  refreshFormError = null;
  showSettingsError(errorElement, null);

  try {
    refreshSettings = await invoke<RefreshSettings>("set_auto_refresh_interval", {
      autoIntervalSeconds,
    });
    sourceRefreshDefaults = null;
    if (settingsOpen && slider.isConnected) {
      setRefreshControls(slider, minutesInput, output, refreshSettings.autoIntervalSeconds);
      bindSourceRefreshDefaults();
    }
  } catch (error) {
    refreshFormError = getErrorMessage(error);
    if (settingsOpen && slider.isConnected) {
      showSettingsError(errorElement, refreshFormError);
      if (refreshSettings) {
        setRefreshControls(slider, minutesInput, output, refreshSettings.autoIntervalSeconds);
      }
    }
    console.error("failed to save refresh interval", error);
  } finally {
    if (settingsOpen && slider.isConnected) {
      slider.disabled = false;
      minutesInput.disabled = false;
    }
  }
}

function bindSourceRefreshDefaults(): void {
  const container = document.querySelector<HTMLElement>("#source-refresh-defaults");
  const errorElement = document.querySelector<HTMLElement>("#source-refresh-error");
  if (!settingsOpen || !container || !errorElement) {
    return;
  }

  showSettingsError(errorElement, sourceRefreshFormError);
  if (sourceRefreshDefaults) {
    renderSourceRefreshDefaults(container, sourceRefreshDefaults);
    return;
  }

  container.textContent = "Loading…";
  void loadSourceRefreshDefaults(container, errorElement);
}

async function loadSourceRefreshDefaults(
  container: HTMLElement,
  errorElement: HTMLElement,
): Promise<void> {
  try {
    sourceRefreshDefaults = await invoke<SourceRefreshDefault[]>("get_source_refresh_defaults");
    sourceRefreshFormError = null;
    if (!settingsOpen || !container.isConnected) {
      return;
    }
    renderSourceRefreshDefaults(container, sourceRefreshDefaults);
    showSettingsError(errorElement, null);
  } catch (error) {
    sourceRefreshFormError = getErrorMessage(error);
    if (settingsOpen && container.isConnected) {
      container.textContent = "Unavailable";
      showSettingsError(errorElement, sourceRefreshFormError);
    }
    console.error("failed to load source refresh defaults", error);
  }
}

function renderSourceRefreshDefaults(
  container: HTMLElement,
  defaults: SourceRefreshDefault[],
): void {
  container.replaceChildren();
  if (defaults.length === 0) {
    container.textContent = "No active source adapters.";
    return;
  }

  for (const source of defaults) {
    const row = document.createElement("div");
    row.className = "settings-source-row";

    const heading = document.createElement("div");
    heading.className = "settings-source-row__heading";
    const label = document.createElement("strong");
    label.textContent = sourceLabel(source.sourceKind);
    const effective = document.createElement("span");
    effective.textContent = source.effectiveIntervalSeconds === null
      ? "Automatic refresh off"
      : `Refreshes every ${formatRefreshInterval(source.effectiveIntervalSeconds)}`;
    heading.append(label, effective);

    const select = document.createElement("select");
    select.setAttribute("aria-label", `${sourceLabel(source.sourceKind)} refresh default`);
    select.append(
      refreshModeOption("inherit", "Use default setting"),
      refreshModeOption("off", "OFF"),
      refreshModeOption("interval", "Custom"),
    );
    select.value = source.mode;

    const minimumSeconds = sourceAutoRefreshFloorSeconds(source.sourceKind);
    const rangeRow = document.createElement("div");
    rangeRow.className = "settings-range-row settings-range-row--exact settings-source-row__range";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(Math.max(1, secondsToSliderPosition(minimumSeconds)));
    slider.max = String(REFRESH_SLIDER_MAX);
    slider.step = "1";
    const startingSeconds = normalizeRefreshSeconds(
      source.autoIntervalSeconds ?? refreshSettings?.autoIntervalSeconds ?? DEFAULT_AUTO_REFRESH_SECONDS,
      minimumSeconds,
    );

    const minutesLabel = document.createElement("label");
    minutesLabel.className = "settings-exact-minutes";
    const minutesInput = document.createElement("input");
    minutesInput.type = "number";
    minutesInput.min = String(Math.ceil(minimumSeconds / 60));
    minutesInput.max = String(Math.floor(MAX_AUTO_REFRESH_SECONDS / 60));
    minutesInput.step = "1";
    minutesInput.inputMode = "numeric";
    minutesInput.setAttribute(
      "aria-label",
      `${sourceLabel(source.sourceKind)} refresh interval in minutes`,
    );
    const minutesUnit = document.createElement("span");
    minutesUnit.textContent = "min";
    minutesLabel.append(minutesInput, minutesUnit);

    const output = document.createElement("output");
    rangeRow.append(slider, minutesLabel, output);

    const syncFromSeconds = (seconds: number): number => {
      const normalized = normalizeRefreshSeconds(seconds, minimumSeconds);
      slider.value = String(
        Math.max(Number(slider.min), secondsToSliderPosition(normalized)),
      );
      minutesInput.value = String(Math.round(normalized / 60));
      output.value = formatRefreshInterval(normalized);
      return normalized;
    };

    const syncVisibility = (): void => {
      const custom = select.value === "interval";
      rangeRow.hidden = !custom;
      slider.disabled = !custom;
      minutesInput.disabled = !custom;
    };
    syncFromSeconds(startingSeconds);
    syncVisibility();

    slider.addEventListener("input", () => {
      const seconds = sliderPositionToSeconds(Number(slider.value)) ?? minimumSeconds;
      const normalized = normalizeRefreshSeconds(seconds, minimumSeconds);
      minutesInput.value = String(Math.round(normalized / 60));
      output.value = formatRefreshInterval(normalized);
    });
    slider.addEventListener("change", () => {
      if (select.value === "interval") {
        const seconds = syncFromSeconds(
          sliderPositionToSeconds(Number(slider.value)) ?? minimumSeconds,
        );
        void saveSourceRefreshDefault(
          source.sourceKind,
          "interval",
          seconds,
          select,
          slider,
          minutesInput,
        );
      }
    });
    minutesInput.addEventListener("input", () => {
      if (minutesInput.value === "") {
        return;
      }
      const minutes = Number(minutesInput.value);
      if (!Number.isFinite(minutes)) {
        return;
      }
      const seconds = refreshMinutesToSeconds(minutes, minimumSeconds);
      slider.value = String(
        Math.max(Number(slider.min), secondsToSliderPosition(seconds)),
      );
      output.value = formatRefreshInterval(seconds);
    });
    minutesInput.addEventListener("change", () => {
      if (select.value !== "interval") {
        return;
      }
      if (minutesInput.value === "" || !Number.isFinite(Number(minutesInput.value))) {
        syncFromSeconds(startingSeconds);
        return;
      }
      const seconds = syncFromSeconds(
        refreshMinutesToSeconds(Number(minutesInput.value), minimumSeconds),
      );
      void saveSourceRefreshDefault(
        source.sourceKind,
        "interval",
        seconds,
        select,
        slider,
        minutesInput,
      );
    });
    select.addEventListener("change", () => {
      syncVisibility();
      const mode = select.value as RefreshMode;
      const seconds = mode === "interval"
        ? syncFromSeconds(refreshMinutesToSeconds(Number(minutesInput.value), minimumSeconds))
        : null;
      void saveSourceRefreshDefault(
        source.sourceKind,
        mode,
        seconds,
        select,
        slider,
        minutesInput,
      );
    });

    row.append(heading, select, rangeRow);
    container.append(row);
  }
}

async function saveSourceRefreshDefault(
  sourceKind: string,
  mode: RefreshMode,
  autoIntervalSeconds: number | null,
  select: HTMLSelectElement,
  slider: HTMLInputElement,
  minutesInput: HTMLInputElement,
): Promise<void> {
  const errorElement = document.querySelector<HTMLElement>("#source-refresh-error");
  select.disabled = true;
  slider.disabled = true;
  minutesInput.disabled = true;
  sourceRefreshFormError = null;
  if (errorElement) {
    showSettingsError(errorElement, null);
  }

  try {
    const updated = await invoke<SourceRefreshDefault>("set_source_refresh_default", {
      sourceKind,
      mode,
      autoIntervalSeconds,
    });
    const current = sourceRefreshDefaults ?? [];
    sourceRefreshDefaults = current.map((item) =>
      item.sourceKind === updated.sourceKind ? updated : item,
    );
    const container = document.querySelector<HTMLElement>("#source-refresh-defaults");
    if (settingsOpen && container) {
      renderSourceRefreshDefaults(container, sourceRefreshDefaults);
    }
  } catch (error) {
    sourceRefreshFormError = getErrorMessage(error);
    if (errorElement?.isConnected) {
      showSettingsError(errorElement, sourceRefreshFormError);
    }
    console.error(`failed to save ${sourceKind} refresh default`, error);
  } finally {
    if (select.isConnected) {
      select.disabled = false;
      const custom = select.value === "interval";
      slider.disabled = !custom;
      minutesInput.disabled = !custom;
    }
  }
}

function refreshModeOption(value: RefreshMode, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function setRefreshExactDisplay(
  minutesInput: HTMLInputElement,
  output: HTMLOutputElement,
  seconds: number | null,
): void {
  minutesInput.value = seconds === null ? "" : String(Math.round(seconds / 60));
  minutesInput.placeholder = seconds === null ? "OFF" : "";
  output.value = formatRefreshInterval(seconds);
}

function setRefreshControls(
  slider: HTMLInputElement,
  minutesInput: HTMLInputElement,
  output: HTMLOutputElement,
  seconds: number | null,
): void {
  slider.value = String(secondsToSliderPosition(seconds));
  setRefreshExactDisplay(minutesInput, output, seconds);
}

function showSettingsError(element: HTMLElement, message: string | null): void {
  element.textContent = message ?? "";
  element.hidden = !message;
}

function handleBoardPointerDown(event: PointerEvent): void {
  const canvas = event.currentTarget as HTMLElement;
  if (boardMode !== "add" || event.target !== canvas) {
    return;
  }

  addPoint = pointToGridCell(event.clientX, event.clientY, canvas.getBoundingClientRect());
  settingsOpen = false;
  shortcutFormError = null;
  refreshFormError = null;
  sourceRefreshFormError = null;
  document.querySelector(".settings-popover")?.remove();
  showAddPicker(addPoint);
}

function bindWidgetInteractions(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-widget-id]")) {
    const id = Number(element.dataset.widgetId);
    if (!Number.isFinite(id)) {
      continue;
    }

    element.querySelector<HTMLElement>("[data-drag-handle]")?.addEventListener("pointerdown", (event) => {
      if (
        boardMode !== "select" ||
        (event.target as HTMLElement).closest("[data-delete-widget], [data-refresh-widget], [data-config-widget]")
      ) {
        return;
      }
      startDrag(event, element, id);
    });

    for (const handle of element.querySelectorAll<HTMLElement>("[data-resize-handle]")) {
      handle.addEventListener("pointerdown", (event) => {
        if (boardMode !== "select") {
          return;
        }
        const direction = handle.dataset.resizeHandle as ResizeDirection | undefined;
        if (direction) {
          startResize(event, element, id, direction);
        }
      });
    }

    element.querySelector<HTMLElement>("[data-delete-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (boardMode === "select") {
        void removeBoardWidget(id);
      }
    });

    element.querySelector<HTMLButtonElement>("[data-config-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (boardMode === "select") {
        openWidgetConfigEditor(element, id);
      }
    });

    element.querySelector<HTMLButtonElement>("[data-refresh-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (boardMode === "select") {
        void refreshBoardWidget(id, event.currentTarget as HTMLButtonElement);
      }
    });
  }
}

function openWidgetConfigEditor(element: HTMLElement, id: number): void {
  if (boardMode !== "select") {
    return;
  }
  const widget = boardWidgets.find((item) => item.id === id);
  if (!widget) {
    return;
  }

  openWidgetSettings(
    element,
    {
      sourceKind: widget.sourceKind,
      sourceConfigJson: widget.sourceConfigJson,
      refreshConfigJson: widget.refreshConfigJson,
    },
    async (input, dismiss) => {
      await saveWidgetSettings(id, element, input, dismiss);
    },
  );
}

async function saveWidgetSettings(
  id: number,
  element: HTMLElement,
  input: WidgetSettingsSaveInput,
  dismiss: () => void,
): Promise<void> {
  let sourceSaved = false;
  try {
    await invoke<WidgetLayout>("update_widget_source_config", {
      id,
      sourceConfigJson: input.sourceConfigJson,
    });
    sourceSaved = true;

    const updated = await invoke<WidgetLayout>("update_widget_refresh_config", {
      id,
      refreshConfigJson: input.refreshConfigJson,
    });

    const index = boardWidgets.findIndex((widget) => widget.id === id);
    if (index >= 0) {
      boardWidgets[index] = updated;
    }

    dismiss();
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
    if (sourceSaved) {
      boardLoaded = false;
      await loadBoardWidgets();
    }
    console.error("failed to save widget settings", error);
    throw error;
  }
}

async function refreshBoardWidget(id: number, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "…";
  button.title = "Queueing refresh";
  try {
    await invoke("refresh_widget", { id });
    if (button.isConnected) {
      button.textContent = "✓";
      button.title = "Refresh queued";
      window.setTimeout(() => {
        if (button.isConnected) {
          button.textContent = original;
          button.title = "Refresh now";
          button.disabled = false;
        }
      }, 1200);
      return;
    }
  } catch (error) {
    console.error("failed to request widget refresh", error);
    if (button.isConnected) {
      button.textContent = "!";
      button.title = getErrorMessage(error);
    }
  }

  if (button.isConnected) {
    window.setTimeout(() => {
      if (button.isConnected) {
        button.textContent = original;
        button.title = "Refresh now";
        button.disabled = false;
      }
    }, 1800);
  }
}

function startDrag(event: PointerEvent, element: HTMLElement, id: number): void {
  if (boardMode !== "select") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const widget = boardWidgets.find((item) => item.id === id);
  const canvas = element.parentElement as HTMLElement;
  if (!widget || !canvas) {
    return;
  }

  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;
  const initial = widgetRect(widget);
  let lastValid = initial;
  const others = otherWidgetRects(id);

  const move = (next: PointerEvent): void => {
    const delta = pointerDeltaToGrid(
      next.clientX - startX,
      next.clientY - startY,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    const candidate = clampGridRect({
      ...initial,
      x: initial.x + delta.x,
      y: initial.y + delta.y,
    });
    if (!collides(candidate, others)) {
      lastValid = candidate;
      applyGridRect(element, candidate);
    }
  };

  const end = (): void => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    updateLocalGeometry(id, lastValid);
    void persistWidgetGeometry(id, lastValid);
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function startResize(
  event: PointerEvent,
  element: HTMLElement,
  id: number,
  direction: ResizeDirection,
): void {
  if (boardMode !== "select") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const widget = boardWidgets.find((item) => item.id === id);
  const canvas = element.parentElement as HTMLElement;
  if (!widget || !canvas) {
    return;
  }

  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;
  const initial = widgetRect(widget);
  let lastValid = initial;
  const others = otherWidgetRects(id);

  const move = (next: PointerEvent): void => {
    const delta = pointerDeltaToGrid(
      next.clientX - startX,
      next.clientY - startY,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    const candidate = resizeGridRect(initial, direction, delta.x, delta.y);
    if (!collides(candidate, others)) {
      lastValid = candidate;
      applyGridRect(element, candidate);
    }
  };

  const end = (): void => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    updateLocalGeometry(id, lastValid);
    void persistWidgetGeometry(id, lastValid);
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function widgetRect(widget: WidgetLayout): GridRect {
  return {
    x: widget.x,
    y: widget.y,
    width: widget.width,
    height: widget.height,
  };
}

function otherWidgetRects(id: number): GridRect[] {
  return boardWidgets.filter((widget) => widget.id !== id).map(widgetRect);
}

function applyGridRect(element: HTMLElement, rect: GridRect): void {
  const style = rectToStyle(rect);
  element.setAttribute("style", style);
}

function updateLocalGeometry(id: number, rect: GridRect): void {
  const widget = boardWidgets.find((item) => item.id === id);
  if (!widget) {
    return;
  }
  widget.x = rect.x;
  widget.y = rect.y;
  widget.width = rect.width;
  widget.height = rect.height;
}

async function loadBoardWidgets(): Promise<void> {
  try {
    const loaded = await invoke<WidgetLayout[]>("list_widgets");
    const { widgets, migrated } = normalizeLoadedWidgets(loaded);
    boardWidgets = widgets;

    for (const widget of migrated) {
      try {
        await invoke("update_widget_geometry", {
          id: widget.id,
          x: widget.x,
          y: widget.y,
          width: widget.width,
          height: widget.height,
        });
      } catch (error) {
        console.error(`failed to persist grid migration for widget ${widget.id}`, error);
      }
    }

    if (currentView === "board") {
      renderBoard();
    }
  } catch (error) {
    boardLoaded = false;
    console.error("failed to load board widgets", error);
  }
}

function normalizeLoadedWidgets(loaded: WidgetLayout[]): {
  widgets: WidgetLayout[];
  migrated: WidgetLayout[];
} {
  const occupied: GridRect[] = [];
  const migrated: WidgetLayout[] = [];
  const widgets = [...loaded].sort((left, right) => left.id - right.id);

  for (const widget of widgets) {
    const original = widgetRect(widget);
    const desired = isValidGridRect(original) ? original : legacyPixelsToGrid(original);
    const placed = findNearestFreeRect(desired, occupied) ?? desired;
    const changed =
      placed.x !== original.x ||
      placed.y !== original.y ||
      placed.width !== original.width ||
      placed.height !== original.height;
    widget.x = placed.x;
    widget.y = placed.y;
    widget.width = placed.width;
    widget.height = placed.height;
    occupied.push(placed);
    if (changed) {
      migrated.push({ ...widget });
    }
  }

  return { widgets, migrated };
}

async function addBoardWidget(sourceKind: string, point: GridPoint): Promise<void> {
  const desired = clampGridRect({
    x: point.x,
    y: point.y,
    width: DEFAULT_WIDGET_COLUMNS,
    height: DEFAULT_WIDGET_ROWS,
  });
  const rect = findNearestFreeRect(desired, boardWidgets.map(widgetRect));
  if (!rect) {
    console.warn("Board grid is full; no free widget rectangle remains");
    return;
  }

  try {
    const widget = await invoke<WidgetLayout>("add_widget", {
      sourceKind,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    boardWidgets.push(widget);
    resetBoardMode();
    renderBoard();
    if (sourceKind === "youtube") {
      const element = document.querySelector<HTMLElement>(`[data-widget-id="${widget.id}"]`);
      if (element) {
        openWidgetConfigEditor(element, widget.id);
      }
    }
  } catch (error) {
    console.error("failed to add widget", error);
  }
}

async function persistWidgetGeometry(id: number, rect: GridRect): Promise<void> {
  try {
    await invoke("update_widget_geometry", {
      id,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
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
  } catch (error) {
    shortcutFormError = getErrorMessage(error);
  }
  syncVisibleShortcutSettings(true);
}

async function transitionView(event: ViewEvent): Promise<void> {
  try {
    const previousView = currentView;
    const nextView = await invoke<ViewState>("transition_view", { event });
    if (nextView === "board" && previousView !== "board") {
      resetBoardMode();
    }
    currentView = nextView;
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

function syncVisibleShortcutSettings(forceInputValue: boolean): void {
  if (currentView !== "board" || !settingsOpen) {
    return;
  }

  const input = document.querySelector<HTMLInputElement>("#shortcut-input");
  const errorElement = document.querySelector<HTMLElement>("#shortcut-error");
  if (input && (forceInputValue || document.activeElement !== input)) {
    input.value = shellStatus.globalShortcut;
  }
  if (errorElement) {
    showSettingsError(errorElement, shortcutFormError ?? shellStatus.globalShortcutError);
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

  syncVisibleShortcutSettings(false);
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
    const previousView = currentView;
    if (event.payload === "board" && previousView !== "board") {
      resetBoardMode();
    }
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
    if (currentView === "board") {
      resetBoardMode();
    }
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

void boot();
