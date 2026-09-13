import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type BootstrapProbe = {
  appName: string;
  storedValue: string;
};

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("#app root was not found");
}

root.innerHTML = `
  <section class="shell" aria-labelledby="title">
    <div class="orb" aria-hidden="true"></div>
    <p class="eyebrow">bootstrap</p>
    <h1 id="title">dopagaki-board</h1>
    <p class="description">
      Rust core + local SQLite + replaceable Tauri WebView.
    </p>
    <button id="probe" type="button">Run Rust ↔ SQLite probe</button>
    <output id="status" class="status" aria-live="polite">Not checked yet.</output>
  </section>
`;

const button = document.querySelector<HTMLButtonElement>("#probe");
const status = document.querySelector<HTMLOutputElement>("#status");

if (!button || !status) {
  throw new Error("bootstrap controls were not found");
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Checking local Rust/SQLite boundary…";

  try {
    const result = await invoke<BootstrapProbe>("bootstrap_probe");
    status.textContent = `${result.appName}: SQLite roundtrip OK (${result.storedValue})`;
  } catch (error) {
    status.textContent = `Probe failed: ${String(error)}`;
  } finally {
    button.disabled = false;
  }
});
