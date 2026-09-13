import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

type ViewState = "hidden" | "idle" | "compact" | "board";
type ViewEvent = "globalToggle" | "clickIdleOrb" | "openBoard" | "hide";

function getAppRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) {
    throw new Error("#app root was not found");
  }
  return element;
}

const root = getAppRoot();
let currentView: ViewState = "idle";

function render(): void {
  document.documentElement.dataset.view = currentView;

  switch (currentView) {
    case "hidden":
      root.replaceChildren();
      break;
    case "idle":
      root.innerHTML = `
        <main class="idle-shell">
          <button id="idle-orb" class="idle-orb" type="button" aria-label="Open dopagaki-board">
            <span class="idle-orb__surface" aria-hidden="true"></span>
            <span class="idle-orb__badge" aria-hidden="true" hidden></span>
          </button>
        </main>
      `;
      document.querySelector("#idle-orb")?.addEventListener("click", () => {
        void transitionView("clickIdleOrb");
      });
      break;
    case "compact":
      root.innerHTML = `
        <main class="compact-shell" aria-label="Quick discovery">
          <header class="compact-toolbar">
            <span class="compact-mark" aria-hidden="true"></span>
            <span class="compact-title">dopagaki</span>
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
      bindCompactActions();
      break;
    case "board":
      root.innerHTML = `
        <main class="board-shell">
          <header class="board-toolbar">
            <strong>Board</strong>
            <span>free placement canvas comes next</span>
            <button class="icon-button" data-action="collapse" type="button" aria-label="Collapse to Idle">×</button>
          </header>
          <section class="board-canvas" aria-label="Board prototype">
            <div class="board-placeholder">Click-empty-space add flow is implemented in #4.</div>
          </section>
        </main>
      `;
      document.querySelector('[data-action="collapse"]')?.addEventListener("click", () => {
        void transitionView("globalToggle");
      });
      break;
  }
}

function bindCompactActions(): void {
  document.querySelector('[data-action="board"]')?.addEventListener("click", () => {
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

  try {
    currentView = await invoke<ViewState>("get_view_state");
  } catch (error) {
    console.error("failed to read initial view state", error);
  }

  render();
}

void boot();
