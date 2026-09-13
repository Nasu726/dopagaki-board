from pathlib import Path

MAIN = Path("src/main.ts")
CSS = Path("src/cache-ui.css")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


main = MAIN.read_text()

main = replace_once(
    main,
    '''type SourceGroup = {
  sourceKind: string;
  sourceConfigJson: string;
  widgetIds: number[];
};

const SOURCE_LABELS''',
    '''type SourceGroup = {
  sourceKind: string;
  sourceConfigJson: string;
  widgetIds: number[];
};

type ArxivSourceConfig = {
  query: string;
  maxResults: number;
};

const SOURCE_LABELS''',
    "arxiv config type",
)

main = replace_once(
    main,
    'const MAX_AUTO_REFRESH_SECONDS = 24 * 60 * 60;\n',
    'const MAX_AUTO_REFRESH_SECONDS = 24 * 60 * 60;\nconst DEFAULT_ARXIV_QUERY = "cat:cs.AI";\nconst DEFAULT_ARXIV_MAX_RESULTS = 12;\n',
    "arxiv defaults",
)

main = replace_once(
    main,
    '''function renderWidgetMarkup(widget: WidgetLayout): string {
  const label = sourceLabel(widget.sourceKind);
  const refreshButton =
    widget.sourceKind === "arxiv"
      ? `<button class="board-widget__refresh" data-refresh-widget type="button" aria-label="Refresh ${label}" title="Refresh now">↻</button>`
      : "";
  return `''',
    '''function renderWidgetMarkup(widget: WidgetLayout): string {
  const label = sourceLabel(widget.sourceKind);
  const configButton =
    widget.sourceKind === "arxiv"
      ? `<button class="board-widget__config" data-config-widget type="button" aria-label="Configure ${label}" title="Source settings">•••</button>`
      : "";
  const refreshButton =
    widget.sourceKind === "arxiv"
      ? `<button class="board-widget__refresh" data-refresh-widget type="button" aria-label="Refresh ${label}" title="Refresh now">↻</button>`
      : "";
  return `''',
    "widget config button declaration",
)

main = replace_once(
    main,
    '''        <span>${label}</span>
        ${refreshButton}
        <button class="board-widget__delete"''',
    '''        <span>${label}</span>
        ${configButton}
        ${refreshButton}
        <button class="board-widget__delete"''',
    "widget config button markup",
)

main = replace_once(
    main,
    'closest("[data-delete-widget], [data-refresh-widget]")',
    'closest("[data-delete-widget], [data-refresh-widget], [data-config-widget]")',
    "drag exclusion",
)

main = replace_once(
    main,
    '''    element.querySelector<HTMLElement>("[data-delete-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeBoardWidget(id);
    });

    element.querySelector<HTMLButtonElement>("[data-refresh-widget]")?.addEventListener("click", (event) => {''',
    '''    element.querySelector<HTMLElement>("[data-delete-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeBoardWidget(id);
    });

    element.querySelector<HTMLButtonElement>("[data-config-widget]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      openWidgetConfigEditor(element, id);
    });

    element.querySelector<HTMLButtonElement>("[data-refresh-widget]")?.addEventListener("click", (event) => {''',
    "config interaction binding",
)

editor_code = r'''function openWidgetConfigEditor(element: HTMLElement, id: number): void {
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

'''

main = replace_once(
    main,
    'async function refreshBoardWidget(id: number, button: HTMLButtonElement): Promise<void> {',
    editor_code + 'async function refreshBoardWidget(id: number, button: HTMLButtonElement): Promise<void> {',
    "editor implementation",
)

MAIN.write_text(main)

css = CSS.read_text()
marker = "/* widget-source-config */"
if marker in css:
    raise RuntimeError("widget source config CSS already present")

css += r'''

/* widget-source-config */
.board-widget__config {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: #89929f;
  background: transparent;
  opacity: 0;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -1px;
  cursor: pointer;
}

.board-widget:hover .board-widget__config,
.board-widget:focus-within .board-widget__config {
  opacity: 1;
}

.board-widget__config:hover,
.board-widget__config:focus-visible {
  color: #46556b;
  background: #edf1f6;
}

.board-widget-config {
  position: absolute;
  z-index: 30;
  inset: 28px 6px 6px;
  display: grid;
  align-content: start;
  gap: 7px;
  overflow: auto;
  padding: 9px;
  border: 1px solid rgba(28, 37, 52, 0.1);
  border-radius: 12px;
  color: #303743;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 8px 24px rgba(31, 41, 57, 0.12);
  cursor: default;
  touch-action: auto;
}

.board-widget-config__header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}

.board-widget-config__header strong {
  margin-right: auto;
  font-size: 10px;
}

.board-widget-config__close {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: #9299a4;
  background: transparent;
  cursor: pointer;
}

.board-widget-config__close:hover {
  color: #525a66;
  background: #f0f1f3;
}

.board-widget-config__field {
  display: grid;
  gap: 3px;
  min-width: 0;
  color: #737c89;
  font-size: 9px;
  font-weight: 650;
}

.board-widget-config__field input {
  min-width: 0;
  width: 100%;
  height: 28px;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid #e1e5ea;
  border-radius: 8px;
  outline: none;
  color: #303743;
  background: #fafbfc;
  font: inherit;
  font-size: 10px;
  font-weight: 500;
  user-select: text;
  touch-action: auto;
}

.board-widget-config__field input:focus {
  border-color: #9eb4df;
  box-shadow: 0 0 0 2px rgba(85, 127, 218, 0.12);
}

.board-widget-config__field--count {
  grid-template-columns: auto 58px;
  align-items: center;
  gap: 8px;
}

.board-widget-config__field--count input {
  justify-self: end;
}

.board-widget-config__help,
.board-widget-config__error {
  margin: 0;
  font-size: 8.5px;
  line-height: 1.3;
}

.board-widget-config__help {
  color: #9299a4;
}

.board-widget-config__error {
  color: #b34b4b;
}

.board-widget-config__actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
}

.board-widget-config__actions button {
  min-height: 25px;
  padding: 4px 8px;
  border: 1px solid #e3e6ea;
  border-radius: 8px;
  color: #56606d;
  background: #f7f8fa;
  font-size: 9px;
  font-weight: 650;
  cursor: pointer;
}

.board-widget-config__actions button[type="submit"] {
  border-color: #d7e0f2;
  color: #35599c;
  background: #eef3fc;
}

.board-widget-config__actions button:disabled,
.board-widget-config input:disabled {
  opacity: 0.55;
  cursor: wait;
}
'''

CSS.write_text(css)
