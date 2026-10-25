# Running your own FORMA

FORMA contains a web application with D1/R2 storage and an outbound-polling Python compute node. GitHub hosts the source; GitHub Pages cannot run this backend. The repository does not include anyone else's CAD projects, credentials or compute service.

## Local development

Use Node.js 22.13+ and Python 3.12. Linux also needs the system libraries required by OpenCascade and Gmsh; on Ubuntu install `libglu1-mesa` and `libgl1`. macOS and Linux are the intended compute targets; Windows has not been validated.

```sh
git clone https://github.com/ultim8digital/forma-engineering.git
cd forma-engineering
npm ci
npm --prefix worker-node/js ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r worker-node/requirements.txt
```

Create local secret files. This writes one fresh worker token to both files without printing it:

```sh
python3.12 - <<'PY'
from pathlib import Path
import secrets
paths = [Path('.dev.vars'), Path('.env.node')]
if any(p.exists() for p in paths):
    raise SystemExit('Secret files already exist; keep your current configuration.')
token = secrets.token_urlsafe(32)
for path, content in zip(paths, [
    f'FORMA_WORKER_TOKEN={token}\n',
    f'FORMA_URL=http://localhost:5173\nFORMA_WORKER_TOKEN={token}\n',
]):
    with path.open('x') as stream:
        path.chmod(0o600)
        stream.write(content)
PY
```

Build once to generate the Wrangler configuration, then initialize a **new** local database:

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_past_thunderbolt_ross.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_lumpy_venus.sql
npm run dev -- --port 5173
```

For an existing database, apply only migrations that have not already been applied. Open `http://localhost:5173` and use the local sign-in. The bundled development shim checks loopback connections and does not require a ChatGPT account. This shim is not available as a production login system.

In a second terminal, from the same directory:

```sh
.venv/bin/python worker-node/runner.py --url http://localhost:5173
```

The web app should report the connected node. Hand-authored examples and declarative manual jobs work without a model account. AI generation needs at least one provider installed and authenticated on the compute machine:

- Codex CLI: `codex login`.
- Claude Code: `claude auth login`. The separately installed JavaScript SDK discovers supported models.
- Compatible API: add `FORMA_LLM_BASE_URL`, `FORMA_LLM_MODEL` and, when needed, `FORMA_LLM_API_KEY` to `.env.node`. This uses `GET /models` and `POST /chat/completions`; compatibility depends on the server and model.

Provider configuration is shown in [.env.example](../.env.example). Model discovery does not guarantee available quota or successful generation. Restart the node after changing its environment.

## Production deployment

The current production integration targets Sites with Cloudflare D1 and R2 bindings named `DB` and `BUCKET`. A fork must provision its **own** database, bucket, application identity and secrets. `.openai/hosting.json` contains generic binding names, not an existing deployment identity. The Sites control plane applies the D1 migrations at publication and supplies real resource bindings.

Set the server's `FORMA_WORKER_TOKEN`, then configure the same token and your published `FORMA_URL` on the compute node. A private Sites deployment additionally needs its own service-access `FORMA_SITES_TOKEN` on the node. This is distinct from the worker secret and from user account cookies.

The current browser login relies on the Sites authentication gateway. Deploying to generic Cloudflare Workers or another host needs your own verified authentication gateway and binding configuration; that migration is not automated by this repository. Merely running `wrangler deploy` is not a complete secure production setup. See [SECURITY.md](../SECURITY.md).

Keep the web deployment and compute deployment separate: the node polls outbound over HTTPS and needs no inbound public port. It must stay running for new jobs. CAD artifacts and project records belong to your own storage. This version is intended for a trusted owner; public multi-user operation requires tenant isolation, quotas and an isolated execution layer.

## Checks and evidence

```sh
npx tsc --noEmit
npm run build
.venv/bin/python -m pytest tests/test_cad.py tests/test_engineering.py -q
```

GitHub Actions runs web checks and the numerical/CAD suite on clean Ubuntu runners. [VALIDATION.md](../VALIDATION.md) contains the historical local and deployment evidence; it is not a promise that your materials, machine or mechanisms are validated. Review all solver and drawing limitations before manufacturing parts.
