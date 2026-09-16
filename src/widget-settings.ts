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
  type RefreshMode,
  formatRefreshInterval,
  normalizeRefreshSeconds,
  readWidgetRefreshConfig,
  refreshMinutesToSeconds,
  secondsToSliderPosition,
  sliderPositionToSeconds,
  sourceAutoRefreshFloorSeconds,
  widgetRefreshConfigJson,
} from "./refresh-controls";

export type WidgetSettingsTarget = {
  sourceKind: string;
  sourceConfigJson: string;
  refreshConfigJson: string;
};

export type WidgetSettingsSaveInput = {
  sourceConfigJson: string;
  refreshConfigJson: string;
};

type SaveWidgetSettings = (
  input: WidgetSettingsSaveInput,
  dismiss: () => void,
) => Promise<void>;

type SourceControl = HTMLInputElement | HTMLSelectElement;

type SourceFields = {
  elements: HTMLElement[];
  controls: SourceControl[];
  focusTarget: HTMLElement;
  selectFocusText?: boolean;
  serialize: () => string;
};

type RefreshSection = {
  element: HTMLDivElement;
  controls: SourceControl[];
  serialize: () => string;
};

const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  arxiv: "arXiv",
  wikipedia: "Wikipedia",
  qiita: "Qiita",
  zenn: "Zenn",
};

export function openWidgetSettings(
  host: HTMLElement,
  widget: WidgetSettingsTarget,
  onSave: SaveWidgetSettings,
): void {
  closeOpenWidgetSettings();

  const source = createSourceFields(widget);
  if (!source) {
    return;
  }

  const label = sourceLabel(widget.sourceKind);
  const form = document.createElement("form");
  form.className = "board-widget-config";
  form.dataset.widgetConfigEditor = "";
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-modal", "true");
  form.setAttribute("aria-label", `${label} widget settings`);
  form.addEventListener("pointerdown", (event) => event.stopPropagation());
  form.addEventListener("click", (event) => event.stopPropagation());

  const header = createHeader(label);
  const refresh = createRefreshSection(widget.refreshConfigJson, widget.sourceKind);
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
  header.close.addEventListener("click", dismiss);
  cancel.addEventListener("click", dismiss);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitWidgetSettings(
      form,
      source,
      refresh,
      errorElement,
      submit,
      dismiss,
      onSave,
    );
  });

  form.append(
    header.element,
    ...source.elements,
    refresh.element,
    errorElement,
    actions,
  );
  const portal = document.querySelector<HTMLElement>(".board-shell") ?? host;
  portal.append(form);
  source.focusTarget.focus();
  if (source.selectFocusText && source.focusTarget instanceof HTMLInputElement) {
    source.focusTarget.select();
  }
}

export function closeOpenWidgetSettings(): void {
  for (const editor of document.querySelectorAll<HTMLElement>("[data-widget-config-editor]")) {
    editor.remove();
  }
}

async function submitWidgetSettings(
  form: HTMLFormElement,
  source: SourceFields,
  refresh: RefreshSection,
  errorElement: HTMLElement,
  submit: HTMLButtonElement,
  dismiss: () => void,
  onSave: SaveWidgetSettings,
): Promise<void> {
  errorElement.textContent = "";
  errorElement.hidden = true;

  let input: WidgetSettingsSaveInput;
  try {
    input = {
      sourceConfigJson: source.serialize(),
      refreshConfigJson: refresh.serialize(),
    };
  } catch (error) {
    if (form.isConnected) {
      errorElement.textContent = getErrorMessage(error);
      errorElement.hidden = false;
    }
    return;
  }

  const controls: Array<SourceControl | HTMLButtonElement> = [
    ...source.controls,
    ...refresh.controls,
    submit,
  ];
  const disabledBefore = controls.map((control) => control.disabled);
  for (const control of controls) {
    control.disabled = true;
  }
  form.setAttribute("aria-busy", "true");

  try {
    await onSave(input, dismiss);
    if (form.isConnected) {
      dismiss();
    }
  } catch (error) {
    if (form.isConnected) {
      errorElement.textContent = getErrorMessage(error);
      errorElement.hidden = false;
    }
  } finally {
    if (form.isConnected) {
      controls.forEach((control, index) => {
        control.disabled = disabledBefore[index];
      });
      form.removeAttribute("aria-busy");
    }
  }
}

function createHeader(label: string): {
  element: HTMLDivElement;
  close: HTMLButtonElement;
} {
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
  return { element: header, close };
}

function createSourceFields(widget: WidgetSettingsTarget): SourceFields | null {
  switch (widget.sourceKind) {
    case "arxiv":
    case "qiita":
      return createQuerySourceFields(widget);
    case "wikipedia":
      return createWikipediaFields(widget);
    case "zenn":
      return createZennFields(widget);
    case "youtube":
      return createYouTubeFields(widget);
    default:
      return null;
  }
}

function createQuerySourceFields(widget: WidgetSettingsTarget): SourceFields {
  const isArxiv = widget.sourceKind === "arxiv";
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

  const queryInput = document.createElement("input");
  queryInput.type = "text";
  queryInput.value = config.query;
  queryInput.maxLength = 512;
  queryInput.autocomplete = "off";
  queryInput.spellcheck = false;
  queryInput.placeholder = isArxiv ? DEFAULT_ARXIV_QUERY : "tag:Python";

  const countInput = createCountInput(config.maxResults, 25);
  const help = createHelp(
    isArxiv
      ? 'Example: cat:cs.AI · ti:"graph neural network"'
      : "Leave empty for recent Qiita items. Example: tag:Python.",
  );

  return {
    elements: [createField("Query", queryInput), createCountField(countInput), help],
    controls: [queryInput, countInput],
    focusTarget: queryInput,
    selectFocusText: true,
    serialize: () =>
      JSON.stringify({
        query: queryInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
  };
}

function createWikipediaFields(widget: WidgetSettingsTarget): SourceFields {
  const config = readWikipediaConfig(widget.sourceConfigJson);
  const languageInput = document.createElement("input");
  languageInput.type = "text";
  languageInput.value = config.language;
  languageInput.minLength = 2;
  languageInput.maxLength = 16;
  languageInput.pattern = "[A-Za-z-]{2,16}";
  languageInput.autocomplete = "off";
  languageInput.spellcheck = false;
  languageInput.placeholder = DEFAULT_WIKIPEDIA_LANGUAGE;

  const countInput = createCountInput(config.maxResults, 25);
  return {
    elements: [
      createField("Language", languageInput),
      createCountField(countInput),
      createHelp("Wikipedia language code, for example ja, en, or de."),
    ],
    controls: [languageInput, countInput],
    focusTarget: languageInput,
    selectFocusText: true,
    serialize: () =>
      JSON.stringify({
        language: languageInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
  };
}

function createZennFields(widget: WidgetSettingsTarget): SourceFields {
  const config = readZennConfig(widget.sourceConfigJson);
  const feedTypeSelect = document.createElement("select");
  feedTypeSelect.append(
    option("trend", "Trend"),
    option("user", "User"),
    option("topic", "Topic"),
  );
  feedTypeSelect.value = config.feedType;

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.value = config.value;
  valueInput.maxLength = 80;
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;

  const valueLabel = createField("", valueInput);
  const valueCaption = valueLabel.querySelector("span");
  const syncFeedType = (): void => {
    const feedType = feedTypeSelect.value as ZennFeedType;
    const trend = feedType === "trend";
    valueLabel.hidden = trend;
    valueInput.disabled = trend;
    if (valueCaption) {
      valueCaption.textContent = feedType === "user" ? "User" : "Topic";
    }
    valueInput.placeholder = feedType === "user" ? "username" : "topic";
  };
  syncFeedType();
  feedTypeSelect.addEventListener("change", syncFeedType);

  const countInput = createCountInput(config.maxResults, 25);
  return {
    elements: [
      createField("Feed", feedTypeSelect),
      valueLabel,
      createCountField(countInput),
      createHelp("Trend needs no value. User/topic values may use letters, numbers, '-' or '_'."),
    ],
    controls: [feedTypeSelect, valueInput, countInput],
    focusTarget: feedTypeSelect,
    serialize: () =>
      JSON.stringify({
        feedType: feedTypeSelect.value,
        value: feedTypeSelect.value === "trend" ? "" : valueInput.value.trim(),
        maxResults: Number(countInput.value),
      }),
  };
}

function createYouTubeFields(widget: WidgetSettingsTarget): SourceFields {
  const config = readYouTubeConfig(widget.sourceConfigJson);
  const channelInput = document.createElement("input");
  channelInput.type = "text";
  channelInput.value = config.channel;
  channelInput.maxLength = 256;
  channelInput.autocomplete = "off";
  channelInput.spellcheck = false;
  channelInput.required = true;
  channelInput.placeholder = "@handle or youtube.com/@handle";

  const countInput = createCountInput(config.maxResults, 15);
  return {
    elements: [
      createField("Channel", channelInput),
      createCountField(countInput),
      createHelp(
        "Paste the channel page URL from your browser, or its @handle. No API key is required.",
      ),
    ],
    controls: [channelInput, countInput],
    focusTarget: channelInput,
    selectFocusText: true,
    serialize: () => {
      const channel = normalizeYouTubeChannelInput(channelInput.value);
      if (!channel) {
        channelInput.focus();
        throw new Error("Paste a YouTube channel URL or @handle.");
      }
      return JSON.stringify({
        channel,
        maxResults: Number(countInput.value),
      });
    },
  };
}

function createRefreshSection(
  refreshConfigJson: string,
  sourceKind: string,
): RefreshSection {
  const refreshConfig = readWidgetRefreshConfig(refreshConfigJson);
  const minimumAutoRefreshSeconds = sourceAutoRefreshFloorSeconds(sourceKind);
  const minimumSeconds = normalizeRefreshSeconds(
    minimumAutoRefreshSeconds,
    minimumAutoRefreshSeconds,
  );

  const refreshSection = document.createElement("div");
  refreshSection.className = "board-widget-config__refresh";
  const refreshSelect = document.createElement("select");
  refreshSelect.append(
    refreshModeOption("inherit", "Use source setting"),
    refreshModeOption("off", "OFF"),
    refreshModeOption("interval", "Custom interval"),
  );
  refreshSelect.value = refreshConfig.mode;

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

  const minutesInput = document.createElement("input");
  minutesInput.type = "number";
  minutesInput.min = String(Math.ceil(minimumSeconds / 60));
  minutesInput.max = String(Math.floor(MAX_AUTO_REFRESH_SECONDS / 60));
  minutesInput.step = "1";
  minutesInput.required = true;
  minutesInput.inputMode = "numeric";
  const exactLabel = createField("Every (minutes)", minutesInput);
  exactLabel.classList.add("board-widget-config__field--count");

  const syncFromSeconds = (seconds: number): void => {
    const normalized = normalizeRefreshSeconds(seconds, minimumSeconds);
    refreshSlider.value = String(
      Math.max(Number(refreshSlider.min), secondsToSliderPosition(normalized)),
    );
    minutesInput.value = String(Math.round(normalized / 60));
    refreshOutput.value = formatRefreshInterval(normalized);
  };

  const syncVisibility = (): void => {
    const custom = refreshSelect.value === "interval";
    refreshRange.hidden = !custom;
    exactLabel.hidden = !custom;
    refreshSlider.disabled = !custom;
    minutesInput.disabled = !custom;
  };

  syncFromSeconds(refreshSeconds);
  syncVisibility();
  refreshSelect.addEventListener("change", syncVisibility);
  refreshSlider.addEventListener("input", () => {
    syncFromSeconds(sliderPositionToSeconds(Number(refreshSlider.value)) ?? minimumSeconds);
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

  const help = createHelp(
    `Minimum automatic interval: ${formatRefreshInterval(minimumSeconds)}. Manual refresh still works while automatic refresh is OFF.`,
  );
  refreshSection.append(
    createField("Automatic refresh", refreshSelect),
    refreshRange,
    exactLabel,
    help,
  );

  return {
    element: refreshSection,
    controls: [refreshSelect, refreshSlider, minutesInput],
    serialize: () => {
      const mode = refreshSelect.value as RefreshMode;
      const customSeconds = refreshMinutesToSeconds(
        Number(minutesInput.value),
        minimumSeconds,
      );
      return widgetRefreshConfigJson(mode, customSeconds);
    },
  };
}

function createField(
  caption: string,
  control: HTMLInputElement | HTMLSelectElement,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "board-widget-config__field";
  const span = document.createElement("span");
  span.textContent = caption;
  label.append(span, control);
  return label;
}

function createCountField(input: HTMLInputElement): HTMLLabelElement {
  const label = createField("Items", input);
  label.classList.add("board-widget-config__field--count");
  return label;
}

function createCountInput(value: number, maximum: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(maximum);
  input.step = "1";
  input.value = String(value);
  return input;
}

function createHelp(text: string): HTMLParagraphElement {
  const help = document.createElement("p");
  help.className = "board-widget-config__help";
  help.textContent = text;
  return help;
}

function refreshModeOption(value: RefreshMode, label: string): HTMLOptionElement {
  return option(value, label);
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
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
