# neofab: local studio setup

neofab 0.4 is a local application. It needs no neofab account, ChatGPT sign-in, cloud database, hosted storage or Sites deployment. The browser UI, SQLite database, filesystem artifacts and CAD worker all run on your computer.

## Install and start

Use Node.js 24+ and Python 3.12, or install `uv` so setup can prepare Python 3.12. On Ubuntu install `libglu1-mesa` and `libgl1` first. macOS and Linux are the intended targets; Windows is not validated.

```sh
git clone https://github.com/ultim8digital/neofab.git
cd neofab
npm ci
npm run setup
npm start
```

Open **http://localhost:5173**. The first start builds missing frontend/server output, creates the database, applies migrations and launches the CAD worker. No secret copying or account creation is needed. Stop with Ctrl+C. After updating source, run `npm ci`, `npm run setup` and `npm run build` before restarting. `npm run dev` runs the local server with frontend HMR.

## Optional models

Open **Connections → Configure API, local model and CLI**. All providers are disabled initially.

- **Local model:** start an Ollama / LM Studio compatible server and load a model. Typical base URLs are `http://127.0.0.1:11434/v1` and `http://127.0.0.1:1234/v1`. neofab does not download or start the model server itself.
- **Your API:** enter a compatible endpoint and your API key. It uses `GET /models` and `POST /chat/completions`. An explicit model ID works when listing is unavailable; it is labeled configured, not successfully tested. Non-loopback HTTP endpoints are rejected; use HTTPS.
- **Codex CLI:** install and authenticate the CLI separately with `codex login`, then enable it in neofab.
- **Claude Code:** install/authenticate the CLI, run `npm run setup:claude` for its optional model-discovery SDK, then enable it. Login remains in the CLI terminal.

Save connections and allow 10–30 seconds for model discovery, then select the provider and model. Model accounts, API credits and inference resources are separate from neofab. Enabled remote providers receive the task and current CAD specification. Hand-authored examples, JSON editing, CAD rebuilding, engineering checks and export work without AI.

## Storage and backups

Default data directory: `forma-data/` inside the checkout. It is ignored by Git. It contains SQLite, artifacts, work files, private `providers.json` and an automatically generated worker token. Keys are saved with mode 0600 and are never returned to the UI. Replacing an API endpoint does not carry its old key to the new address.

Stop the application and back up the entire directory. Environment overrides are `FORMA_DATA_DIR`, `FORMA_PORT` and `FORMA_PYTHON` (absolute interpreter path). The app does not load historical `.env.node` / `.dev.vars` files. No automatic migration of old cloud projects is provided; a fresh installation has an empty workspace and labeled teaching examples.

## Access boundary

The server binds to **127.0.0.1 only**, validates Host and Origin, and rejects cross-site requests. There is no account system. Local scripts writing through the user API must supply a matching local Origin; workers and external agents use local tokens. Provider settings are available only to the local UI role.

This is not a public multi-user server. Do not tunnel or reverse-proxy it to the internet without separate authentication and execution isolation. See [SECURITY.md](../SECURITY.md).

## MCP and validation

With neofab running, `npm run mcp` starts the eight-tool stdio bridge. It reads the local worker token automatically. For a different location use `FORMA_DATA_DIR`; for a different port use `FORMA_URL`. You may instead pass a UI-created revocable `FORMA_AGENT_TOKEN`.

```sh
npx tsc --noEmit
npm run build
npm run test:local
npm run test:editor
npm run test:engineering
.venv/bin/python tests/exercise_engineering_api.py
```

The final command needs the running app and executes real beam, slider and four-bar CAD/engineering cases. Provider HTTP fixtures test transport only; they are not real AI generations. Numerical and manufacturing limitations remain explicit in [README.md](../README.md) and in generated reports. Tests are not manufacturing certification.

## Workspace and manual editing

Select a part in the canvas or tree. The inspector edits all supported declarative CAD operations and component placement. Drag the translation/rotation gizmo or enter coordinates. Single-box dimensions preview exactly; complex boolean/edge edits wait for the CAD kernel. The draft indicator distinguishes previews from built geometry and disables artifact export until rebuilding. Undo/redo keeps up to 60 local document edits, including after manual CAD builds.

Measurements and visual clipping operate on the tessellated mesh. Color presets affect viewport appearance only. Arbitrary mesh sculpting and STEP import remain outside the supported geometry model.

The former FORMA data directory and environment variable names remain compatible, so existing local projects are preserved.
