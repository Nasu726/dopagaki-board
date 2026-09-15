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
  DEFAULT_ARXIV_MAX_RESULTS,
  DEFAULT_ARXIV_QUERY,
  DEFAULT_QIITA_MAX_RESULTS,
  DEFAULT_QIITA_QUERY,
  DEFAULT_WIKIPEDIA_LANGUAGE,
  type ZennFeedType,
  normalizeYouTubeChannelInput,
  readQuerySourceConfig,
  readWikipediaConfig,
  readYouTubeConfig,
  readZennConfig,
} from "./source-config";
import {
  DEFAULT_AUTO_REFRESH_SECONDS,
  MAX_AUTO_REFRESH_SECONDS,
  REFRESH_SLIDER_MAX,
  formatRefreshInterval,
  normalizeRefreshSeconds,
  refreshMinutesToSeconds,
  secondsToSliderPosition,
  sliderPositionToSeconds,
  sourceAutoRefreshFloorSeconds,
} from "./refresh-controls";
import "./styles.css";
import "./cache-ui.css";

type ViewState = "hidden" | "idle" | "compact" | "board";
type ViewEvent =
  | "globalToggle"
  | "clickIdleOrb"
  | "openCompact"
  | "openBoard"
  | "hide";

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

type WidgetRefreshConfig = {
  mode: RefreshMode;
  autoIntervalSeconds: number | null;
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
  const pickerMarkup = addPoint ? renderAddPickerMarkup(addPoint) : "";
  const settingsMarkup = settingsOpen ? renderSettingsMarkup() : "";

  root.innerHTML = `
    <main class="board-shell">
      <header class="board-toolbar">
        <div class="window-drag-region" data-tauri-drag-region title="Drag window">
          <strong data-tauri-drag-region>Board</strong>
          <span class="board-toolbar__hint" data-tauri-drag-region>Click empty space to add · drag widgets to move</span>
        </div>
        <button class="icon-button" data-action="settings" type="button" aria-label="Settings" title="Settings">⚙</button>
        <button class="icon-button" data-action="restore" type="button" aria-label="Restore Compact" title="Restore down to Compact">▱</button>
        <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle" title="Minimize to Idle">—</button>
      </header>
      <section class="board-canvas${boardWidgets.length === 0 ? " board-canvas--empty" : ""}" aria-label="Discovery Board">
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
    settingsOpen = !settingsOpen;
    shortcutFormError = null;
    refreshFormError = null;
    sourceRefreshFormError = null;
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

  bindSettings();
  bindWidgetInteractions();
  void hydrateBoardWidgets(generation);

  if (!boardLoaded) {
    boardLoaded = true;
    void loadBoardWidgets();
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
        <label for="refresh-interval">Global automatic refresh fallback</label>
        <div class="settings-range-row">
          <input id="refresh-interval" type="range" min="0" max="${REFRESH_SLIDER_MAX}" step="1">
          <output id="refresh-interval-output" for="refresh-interval">Loading…</output>
        </div>
        <p>Left edge is OFF. Source settings may use this value or choose their own.</p>
        <p id="refresh-error" class="settings-error" hidden></p>
      </section>
      <section class="settings-section" aria-label="Source refresh defaults">
        <label>Source refresh</label>
        <div id="source-refresh-defaults" class="settings-source-list" aria-live="polite">Loading…</div>
        <p>Each widget can use its source setting, turn automatic refresh off, or choose its own interval. Source minimum intervals still apply.</p>
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
    settingsOpen = false;
    shortcutFormError = null;
    refreshFormError = null;
    sourceRefreshFormError = null;
    renderBoard();
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
  const output = document.querySelector<HTMLOutputElement>("#refresh-interval-output");
  const refreshError = document.querySelector<HTMLElement>("#refresh-error");
  if (slider && output && refreshError) {
    slider.addEventListener("input", () => {
      output.value = formatRefreshInterval(sliderPositionToSeconds(Number(slider.value)));
    });
    slider.addEventListener("change", () => {
      void saveAutoRefreshInterval(Number(slider.value), slider, output, refreshError);
    });

    if (refreshSettings) {
      setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
      showSettingsError(refreshError, refreshFormError);
    } else {
      slider.disabled = true;
      output.value = "Loading…";
      void loadRefreshSettings(slider, output, refreshError);
    }
  }

  bindSourceRefreshDefaults();
}

async function loadRefreshSettings(
  slider: HTMLInputElement,
  output: HTMLOutputElement,
  errorElement: HTMLElement,
): Promise<void> {
  try {
    refreshSettings = await invoke<RefreshSettings>("get_refresh_settings");
    if (!settingsOpen || !slider.isConnected) {
      return;
    }
    setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
    slider.disabled = false;
    showSettingsError(errorElement, refreshFormError);
  } catch (error) {
    if (settingsOpen && slider.isConnected) {
      slider.disabled = true;
      output.value = "Unavailable";
      showSettingsError(errorElement, getErrorMessage(error));
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
  showSettingsError(errorElement, null);

  try {
    refreshSettings = await invoke<RefreshSettings>("set_auto_refresh_interval", {
      autoIntervalSeconds,
    });
    sourceRefreshDefaults = null;
    if (settingsOpen && slider.isConnected) {
      setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
      bindSourceRefreshDefaults();
    }
  } catch (error) {
    refreshFormError = getErrorMessage(error);
    if (settingsOpen && slider.isConnected) {
      showSettingsError(errorElement, refreshFormError);
      if (refreshSettings) {
        setRefreshControls(slider, output, refreshSettings.autoIntervalSeconds);
      }
    }
    console.error("failed to save refresh interval", error);
  } finally {
    if (settingsOpen && slider.isConnected) {
      slider.disabled = false;
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
      refreshModeOption("inherit", "Use global setting"),
      refreshModeOption("off", "OFF"),
      refreshModeOption("interval", "Custom"),
    );
    select.value = source.mode;

    const rangeRow = document.createElement("div");
    rangeRow.className = "settings-range-row settings-source-row__range";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = String(REFRESH_SLIDER_MAX);
    slider.step = "1";
    const startingSeconds =
      source.autoIntervalSeconds ?? refreshSettings?.autoIntervalSeconds ?? DEFAULT_AUTO_REFRESH_SECONDS;
    slider.value = String(Math.max(1, secondsToSliderPosition(startingSeconds)));
    const output = document.createElement("output");
    output.value = formatRefreshInterval(startingSeconds);
    rangeRow.append(slider, output);

    const syncVisibility = (): void => {
      rangeRow.hidden = select.value !== "interval";
    };
    syncVisibility();

    slider.addEventListener("input", () => {
      output.value = formatRefreshInterval(sliderPositionToSeconds(Number(slider.value)));
    });
    select.addEventListener("change", () => {
      syncVisibility();
      const mode = select.value as RefreshMode;
      const seconds =
        mode === "interval" ? sliderPositionToSeconds(Number(slider.value)) : null;
      void saveSourceRefreshDefault(source.sourceKind, mode, seconds, select, slider);
    });
    slider.addEventListener("change", () => {
      if (select.value === "interval") {
        void saveSourceRefreshDefault(
          source.sourceKind,
          "interval",
          sliderPositionToSeconds(Number(slider.value)),
          select,
          slider,
        );
      }
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
): Promise<void> {
  const errorElement = document.querySelector<HTMLElement>("#source-refresh-error");
  select.disabled = true;
  slider.disabled = true;
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
      slider.disabled = false;
    }
  }
}

function refreshModeOption(value: RefreshMode, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function setRefreshControls(
  slider: HTMLInputElement,
  output: HTMLOutputElement,
  seconds: number | null,
): void {
  slider.value = String(secondsToSliderPosition(seconds));
  output.value = formatRefreshInterval(seconds);
}

function showSettingsError(element: HTMLElement, message: string | null): void {
  element.textContent = message ?? "";
  element.hidden = !message;
}

function handleBoardPointerDown(event: PointerEvent): void {
  const canvas = event.currentTarget as HTMLElement;
  if (event.target !== canvas) {
    return;
  }

  addPoint = pointToGridCell(event.clientX, event.clientY, canvas.getBoundingClientRect());
  settingsOpen = false;
  shortcutFormError = null;
  refreshFormError = null;
  sourceRefreshFormError = null;
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

    for (const handle of element.querySelectorAll<HTMLElement>("[data-resize-handle]")) {
      handle.addEventListener("pointerdown", (event) => {
        const direction = handle.dataset.resizeHandle as ResizeDirection | undefined;
        if (direction) {
          startResize(event, element, id, direction);
        }
      });
    }

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
  if (!widget) {
    return;
  }
  if (widget.sourceKind === "wikipedia") {
    openWikipediaWidgetConfigEditor(element, widget);
    return;
  }
  if (widget.sourceKind === "zenn") {
    openZennWidgetConfigEditor(element, widget);
    return;
  }
  if (widget.sourceKind === "youtube") {
    openYouTubeWidgetConfigEditor(element, widget);
    return;
  }
  if (widget.sourceKind === "arxiv" || widget.sourceKind === "qiita") {
    openQuerySourceWidgetConfigEditor(element, widget);
  }
}

function openQuerySourceWidgetConfigEditor(element: HTMLElement, widget: WidgetLayout): void {
  const isArxiv = widget.sourceKind === "arxiv";
  const label = isArxiv ? "arXiv" : "Qiita";
  const config = isArxiv
    ? readQuerySourceConfig(
        widget.sourceConfigJson,
        DEFAULT_ARXIV_QUERY,
        DEFAULT_ARXIV_MAX_RESULTS,
      )
    : readQuerySourceConfig(
        widget.sourceConfigJson,
        DEFAULT_QIITA_QUERY,
        DEFAULT_QIITA_MAX_RESULTS,
      );
  const refreshFloorSeconds = sourceAutoRefreshFloorSeconds(widget.sourceKind);

  for (const editor of document.querySelectorAll<HTMLElement>("[data-widget-config-editor]")) {
    editor.remove();
  }

  const refreshConfig = readWidgetRefreshConfig(widget.refreshConfigJson);
  const form = document.createElement("form");
  form.className = "board-widget-config";
  form.dataset.widgetConfigEditor = "";
  form.setAttribute("aria-label", `${label} widget settings`);
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "board-widget-config__header";
  const title = document.createElement("strong");
  title.textContent = `${label} widget`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "board-widget-config__close";
  close.setAttribute("aria-label", "Close widget settings");
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
  queryInput.placeholder = isArxiv ? DEFAULT_ARXIV_QUERY : "tag:Python";
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
  help.textContent = isArxiv
    ? 'Example: cat:cs.AI · ti:"graph neural network"'
    : "Leave empty for recent Qiita items. Example: tag:Python.";

  const refreshSection = createWidgetRefreshSection(
    refreshConfig,
    refreshFloorSeconds,
    `Minimum automatic interval: ${formatRefreshInterval(refreshFloorSeconds)}. Manual refresh still works while automatic refresh is OFF.`,
  );

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
    void saveWidgetSettings(
      widget.id,
      element,
      form,
      JSON.stringify({
        query: queryInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
      [queryInput, countInput],
      refreshSection.select,
      refreshSection.slider,
      refreshSection.minutesInput,
      errorElement,
      submit,
    );
  });

  form.append(
    header,
    queryLabel,
    countLabel,
    help,
    refreshSection.element,
    errorElement,
    actions,
  );
  element.append(form);
  queryInput.focus();
  queryInput.select();
}

function openWikipediaWidgetConfigEditor(element: HTMLElement, widget: WidgetLayout): void {
  for (const editor of document.querySelectorAll<HTMLElement>("[data-widget-config-editor]")) {
    editor.remove();
  }

  const config = readWikipediaConfig(widget.sourceConfigJson);
  const refreshConfig = readWidgetRefreshConfig(widget.refreshConfigJson);
  const refreshFloorSeconds = sourceAutoRefreshFloorSeconds(widget.sourceKind);
  const form = document.createElement("form");
  form.className = "board-widget-config";
  form.dataset.widgetConfigEditor = "";
  form.setAttribute("aria-label", "Wikipedia widget settings");
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "board-widget-config__header";
  const title = document.createElement("strong");
  title.textContent = "Wikipedia widget";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "board-widget-config__close";
  close.setAttribute("aria-label", "Close widget settings");
  close.textContent = "×";
  header.append(title, close);

  const languageLabel = document.createElement("label");
  languageLabel.className = "board-widget-config__field";
  const languageCaption = document.createElement("span");
  languageCaption.textContent = "Language";
  const languageInput = document.createElement("input");
  languageInput.type = "text";
  languageInput.value = config.language;
  languageInput.minLength = 2;
  languageInput.maxLength = 16;
  languageInput.pattern = "[A-Za-z-]{2,16}";
  languageInput.autocomplete = "off";
  languageInput.spellcheck = false;
  languageInput.placeholder = DEFAULT_WIKIPEDIA_LANGUAGE;
  languageLabel.append(languageCaption, languageInput);

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
  help.textContent = "Wikipedia language code, for example ja, en, or de.";

  const refreshSection = createWidgetRefreshSection(
    refreshConfig,
    refreshFloorSeconds,
    `Minimum automatic interval: ${formatRefreshInterval(refreshFloorSeconds)}. Manual refresh still works while automatic refresh is OFF.`,
  );

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
    void saveWidgetSettings(
      widget.id,
      element,
      form,
      JSON.stringify({
        language: languageInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
      [languageInput, countInput],
      refreshSection.select,
      refreshSection.slider,
      refreshSection.minutesInput,
      errorElement,
      submit,
    );
  });

  form.append(
    header,
    languageLabel,
    countLabel,
    help,
    refreshSection.element,
    errorElement,
    actions,
  );
  element.append(form);
  languageInput.focus();
  languageInput.select();
}

function openZennWidgetConfigEditor(element: HTMLElement, widget: WidgetLayout): void {
  for (const editor of document.querySelectorAll<HTMLElement>("[data-widget-config-editor]")) {
    editor.remove();
  }

  const config = readZennConfig(widget.sourceConfigJson);
  const refreshConfig = readWidgetRefreshConfig(widget.refreshConfigJson);
  const refreshFloorSeconds = sourceAutoRefreshFloorSeconds(widget.sourceKind);
  const form = document.createElement("form");
  form.className = "board-widget-config";
  form.dataset.widgetConfigEditor = "";
  form.setAttribute("aria-label", "Zenn widget settings");
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "board-widget-config__header";
  const title = document.createElement("strong");
  title.textContent = "Zenn widget";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "board-widget-config__close";
  close.setAttribute("aria-label", "Close widget settings");
  close.textContent = "×";
  header.append(title, close);

  const feedTypeLabel = document.createElement("label");
  feedTypeLabel.className = "board-widget-config__field";
  const feedTypeCaption = document.createElement("span");
  feedTypeCaption.textContent = "Feed";
  const feedTypeSelect = document.createElement("select");
  feedTypeSelect.append(
    zennFeedTypeOption("trend", "Trend"),
    zennFeedTypeOption("user", "User"),
    zennFeedTypeOption("topic", "Topic"),
  );
  feedTypeSelect.value = config.feedType;
  feedTypeLabel.append(feedTypeCaption, feedTypeSelect);

  const valueLabel = document.createElement("label");
  valueLabel.className = "board-widget-config__field";
  const valueCaption = document.createElement("span");
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.value = config.value;
  valueInput.maxLength = 80;
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;
  valueLabel.append(valueCaption, valueInput);

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
  help.textContent = "Trend needs no value. User/topic values may use letters, numbers, '-' or '_'.";

  const syncFeedType = (): void => {
    const feedType = feedTypeSelect.value as ZennFeedType;
    const trend = feedType === "trend";
    valueLabel.hidden = trend;
    valueInput.disabled = trend;
    valueCaption.textContent = feedType === "user" ? "User" : "Topic";
    valueInput.placeholder = feedType === "user" ? "username" : "topic";
  };
  syncFeedType();
  feedTypeSelect.addEventListener("change", syncFeedType);

  const refreshSection = createWidgetRefreshSection(
    refreshConfig,
    refreshFloorSeconds,
    `Minimum automatic interval: ${formatRefreshInterval(refreshFloorSeconds)}. Manual refresh still works while automatic refresh is OFF.`,
  );

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
    void saveWidgetSettings(
      widget.id,
      element,
      form,
      JSON.stringify({
        feedType: feedTypeSelect.value,
        value: feedTypeSelect.value === "trend" ? "" : valueInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
      [feedTypeSelect, valueInput, countInput],
      refreshSection.select,
      refreshSection.slider,
      refreshSection.minutesInput,
      errorElement,
      submit,
    ).finally(syncFeedType);
  });

  form.append(
    header,
    feedTypeLabel,
    valueLabel,
    countLabel,
    help,
    refreshSection.element,
    errorElement,
    actions,
  );
  element.append(form);
  feedTypeSelect.focus();
}

function openYouTubeWidgetConfigEditor(element: HTMLElement, widget: WidgetLayout): void {
  for (const editor of document.querySelectorAll<HTMLElement>("[data-widget-config-editor]")) {
    editor.remove();
  }

  const config = readYouTubeConfig(widget.sourceConfigJson);
  const refreshConfig = readWidgetRefreshConfig(widget.refreshConfigJson);
  const refreshFloorSeconds = sourceAutoRefreshFloorSeconds(widget.sourceKind);
  const form = document.createElement("form");
  form.className = "board-widget-config";
  form.dataset.widgetConfigEditor = "";
  form.setAttribute("aria-label", "YouTube widget settings");
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "board-widget-config__header";
  const title = document.createElement("strong");
  title.textContent = "YouTube widget";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "board-widget-config__close";
  close.setAttribute("aria-label", "Close widget settings");
  close.textContent = "×";
  header.append(title, close);

  const channelLabel = document.createElement("label");
  channelLabel.className = "board-widget-config__field";
  const channelCaption = document.createElement("span");
  channelCaption.textContent = "Channel";
  const channelInput = document.createElement("input");
  channelInput.type = "text";
  channelInput.value = config.channelId;
  channelInput.maxLength = 256;
  channelInput.autocomplete = "off";
  channelInput.spellcheck = false;
  channelInput.required = true;
  channelInput.placeholder = "UC... or youtube.com/channel/UC...";
  channelLabel.append(channelCaption, channelInput);

  const countLabel = document.createElement("label");
  countLabel.className = "board-widget-config__field board-widget-config__field--count";
  const countCaption = document.createElement("span");
  countCaption.textContent = "Items";
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.max = "15";
  countInput.step = "1";
  countInput.value = String(config.maxResults);
  countLabel.append(countCaption, countInput);

  const help = document.createElement("p");
  help.className = "board-widget-config__help";
  help.textContent = "Paste a UC-prefixed channel ID or a YouTube /channel/UC... URL. Automatic @handle lookup will be added with optional Data API support; RSS itself needs no API key.";

  const refreshSection = createWidgetRefreshSection(
    refreshConfig,
    refreshFloorSeconds,
    `Minimum automatic interval: ${formatRefreshInterval(refreshFloorSeconds)}. Manual refresh still works while automatic refresh is OFF.`,
  );

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
    const channelId = normalizeYouTubeChannelInput(channelInput.value);
    if (!channelId) {
      errorElement.textContent = "Enter a valid UC... channel ID or a YouTube /channel/UC... URL.";
      errorElement.hidden = false;
      channelInput.focus();
      return;
    }
    void saveWidgetSettings(
      widget.id,
      element,
      form,
      JSON.stringify({
        channelId,
        maxResults: Number(countInput.value),
      }),
      [channelInput, countInput],
      refreshSection.select,
      refreshSection.slider,
      refreshSection.minutesInput,
      errorElement,
      submit,
    );
  });

  form.append(
    header,
    channelLabel,
    countLabel,
    help,
    refreshSection.element,
    errorElement,
    actions,
  );
  element.append(form);
  channelInput.focus();
  channelInput.select();
}

function createWidgetRefreshSection(
  refreshConfig: WidgetRefreshConfig,
  minimumAutoRefreshSeconds: number,
  helpText: string,
): {
  element: HTMLDivElement;
  select: HTMLSelectElement;
  slider: HTMLInputElement;
  minutesInput: HTMLInputElement;
} {
  const minimumSeconds = normalizeRefreshSeconds(
    minimumAutoRefreshSeconds,
    minimumAutoRefreshSeconds,
  );
  const refreshSection = document.createElement("div");
  refreshSection.className = "board-widget-config__refresh";
  const refreshLabel = document.createElement("label");
  refreshLabel.className = "board-widget-config__field";
  const refreshCaption = document.createElement("span");
  refreshCaption.textContent = "Automatic refresh";
  const refreshSelect = document.createElement("select");
  refreshSelect.append(
    refreshModeOption("inherit", "Use source setting"),
    refreshModeOption("off", "OFF"),
    refreshModeOption("interval", "Custom interval"),
  );
  refreshSelect.value = refreshConfig.mode;
  refreshLabel.append(refreshCaption, refreshSelect);

  const refreshRange = document.createElement("div");
  refreshRange.className = "board-widget-config__range";
  const refreshSlider = document.createElement("input");
  refreshSlider.type = "range";
  refreshSlider.min = String(Math.max(1, secondsToSliderPosition(minimumSeconds)));
  refreshSlider.max = String(REFRESH_SLIDER_MAX);
  refreshSlider.step = "1";
  const configuredSeconds = refreshConfig.autoIntervalSeconds ?? DEFAULT_AUTO_REFRESH_SECONDS;
  const refreshSeconds = normalizeRefreshSeconds(configuredSeconds, minimumSeconds);
  const refreshOutput = document.createElement("output");
  refreshRange.append(refreshSlider, refreshOutput);

  const exactLabel = document.createElement("label");
  exactLabel.className = "board-widget-config__field board-widget-config__field--count";
  const exactCaption = document.createElement("span");
  exactCaption.textContent = "Every (minutes)";
  const minutesInput = document.createElement("input");
  minutesInput.type = "number";
  minutesInput.min = String(Math.ceil(minimumSeconds / 60));
  minutesInput.max = String(Math.floor(MAX_AUTO_REFRESH_SECONDS / 60));
  minutesInput.step = "1";
  minutesInput.required = true;
  minutesInput.inputMode = "numeric";
  exactLabel.append(exactCaption, minutesInput);

  const refreshHelp = document.createElement("p");
  refreshHelp.className = "board-widget-config__help";
  refreshHelp.textContent = helpText;
  refreshSection.append(refreshLabel, refreshRange, exactLabel, refreshHelp);

  const syncFromSeconds = (seconds: number): void => {
    const normalized = normalizeRefreshSeconds(seconds, minimumSeconds);
    refreshSlider.value = String(
      Math.max(Number(refreshSlider.min), secondsToSliderPosition(normalized)),
    );
    minutesInput.value = String(Math.round(normalized / 60));
    refreshOutput.value = formatRefreshInterval(normalized);
  };

  const syncRefreshControls = (): void => {
    const custom = refreshSelect.value === "interval";
    refreshRange.hidden = !custom;
    exactLabel.hidden = !custom;
    refreshSlider.disabled = !custom;
    minutesInput.disabled = !custom;
  };

  syncFromSeconds(refreshSeconds);
  syncRefreshControls();
  refreshSelect.addEventListener("change", syncRefreshControls);
  refreshSlider.addEventListener("input", () => {
    const seconds = sliderPositionToSeconds(Number(refreshSlider.value)) ?? minimumSeconds;
    syncFromSeconds(seconds);
  });
  minutesInput.addEventListener("input", () => {
    if (minutesInput.value === "") {
      return;
    }
    const minutes = Number(minutesInput.value);
    if (!Number.isFinite(minutes)) {
      return;
    }
    const normalized = refreshMinutesToSeconds(minutes, minimumSeconds);
    refreshSlider.value = String(
      Math.max(Number(refreshSlider.min), secondsToSliderPosition(normalized)),
    );
    refreshOutput.value = formatRefreshInterval(normalized);
  });
  minutesInput.addEventListener("change", () => {
    syncFromSeconds(refreshMinutesToSeconds(Number(minutesInput.value), minimumSeconds));
  });

  return { element: refreshSection, select: refreshSelect, slider: refreshSlider, minutesInput };
}

function zennFeedTypeOption(value: ZennFeedType, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function readWidgetRefreshConfig(refreshConfigJson: string): WidgetRefreshConfig {
  try {
    const parsed = JSON.parse(refreshConfigJson) as {
      mode?: unknown;
      autoIntervalSeconds?: unknown;
    };
    if (parsed.mode === "off") {
      return { mode: "off", autoIntervalSeconds: null };
    }
    if (
      parsed.mode === "interval" &&
      typeof parsed.autoIntervalSeconds === "number" &&
      Number.isFinite(parsed.autoIntervalSeconds)
    ) {
      return { mode: "interval", autoIntervalSeconds: parsed.autoIntervalSeconds };
    }
  } catch {
    // Invalid persisted data is treated as inherit in the presentation layer;
    // the Rust policy boundary remains authoritative when saving.
  }
  return { mode: "inherit", autoIntervalSeconds: null };
}

function widgetRefreshConfigJson(
  mode: RefreshMode,
  autoIntervalSeconds: number | null,
): string {
  if (mode === "inherit") {
    return "{}";
  }
  if (mode === "off") {
    return JSON.stringify({ mode: "off" });
  }
  return JSON.stringify({ mode: "interval", autoIntervalSeconds });
}

async function saveWidgetSettings(
  id: number,
  element: HTMLElement,
  form: HTMLFormElement,
  sourceConfigJson: string,
  sourceControls: Array<HTMLInputElement | HTMLSelectElement>,
  refreshSelect: HTMLSelectElement,
  refreshSlider: HTMLInputElement,
  refreshMinutes: HTMLInputElement,
  errorElement: HTMLElement,
  submitButton: HTMLButtonElement,
): Promise<void> {
  errorElement.hidden = true;
  errorElement.textContent = "";
  submitButton.disabled = true;
  for (const control of sourceControls) {
    control.disabled = true;
  }
  refreshSelect.disabled = true;
  refreshSlider.disabled = true;
  refreshMinutes.disabled = true;
  form.setAttribute("aria-busy", "true");

  let sourceSaved = false;
  try {
    await invoke<WidgetLayout>("update_widget_source_config", {
      id,
      sourceConfigJson,
    });
    sourceSaved = true;

    const customSeconds = refreshMinutesToSeconds(
      Number(refreshMinutes.value),
      Number(refreshMinutes.min) * 60,
    );
    const updated = await invoke<WidgetLayout>("update_widget_refresh_config", {
      id,
      refreshConfigJson: widgetRefreshConfigJson(
        refreshSelect.value as RefreshMode,
        customSeconds,
      ),
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
    if (sourceSaved) {
      boardLoaded = false;
      await loadBoardWidgets();
    }
    if (form.isConnected) {
      errorElement.textContent = getErrorMessage(error);
      errorElement.hidden = false;
    }
    console.error("failed to save widget settings", error);
  } finally {
    if (form.isConnected) {
      submitButton.disabled = false;
      for (const control of sourceControls) {
        control.disabled = false;
      }
      refreshSelect.disabled = false;
      const custom = refreshSelect.value === "interval";
      refreshSlider.disabled = !custom;
      refreshMinutes.disabled = !custom;
      form.removeAttribute("aria-busy");
    }
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
    addPoint = null;
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
    if (currentView === "board" && settingsOpen) {
      renderBoard();
    }
  } catch (error) {
    shortcutFormError = getErrorMessage(error);
    if (currentView === "board" && settingsOpen) {
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

  if (currentView === "board" && settingsOpen) {
    const input = document.querySelector<HTMLInputElement>("#shortcut-input");
    const errorElement = document.querySelector<HTMLElement>("#shortcut-error");
    if (input && document.activeElement !== input) {
      input.value = shellStatus.globalShortcut;
    }
    if (errorElement) {
      showSettingsError(errorElement, shortcutFormError ?? shellStatus.globalShortcutError);
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

void boot();
