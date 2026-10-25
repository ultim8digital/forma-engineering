# Security

Report exploitable issues through [GitHub private vulnerability reporting](https://github.com/ultim8digital/forma-engineering/security/advisories/new). Do not post credentials or private CAD models in public issues.

## Local application boundary

FORMA 0.3 has no account system. It is intended for one trusted owner on one computer. The HTTP listener binds to 127.0.0.1, accepts only the configured localhost/loopback Host values, validates Origin and rejects cross-site fetches. Writes without a browser Origin require a local token. Worker endpoints require the generated worker secret. Identity headers from external login systems are not trusted or used.

Do not expose this listener through LAN forwarding, a tunnel or a public reverse proxy. Such use needs its own authentication, quotas and isolated compute. Another process running as your OS user can access your local data; this application does not isolate mutually untrusted local users or processes.

The ignored data directory contains database records, generated parts, private provider settings and the local worker token. Provider keys are stored with mode 0600 and are redacted from settings responses. Never commit or share that directory. When an API endpoint changes, an old key is discarded unless a new key is supplied explicitly. Use HTTPS for non-loopback API endpoints.

All AI providers are disabled by default. CLI providers must be enabled explicitly and run with the compute owner's permissions. No passwords or subscription tokens are extracted by FORMA. Enabled API/CLI providers receive the task and CAD specification. The CAD compiler accepts validated declarative geometry, not executable model-generated Python.

The newest main branch is the maintenance target. Engineering correctness issues can be public when they include no sensitive data; include units, assumptions and an independent reproducible reference.
