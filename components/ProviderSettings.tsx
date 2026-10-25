import { useEffect, useState } from "react";

type Endpoint = { enabled: boolean; base_url: string; model: string; api_key: string; has_api_key?: boolean; clear_api_key?: boolean };
type Config = { local: Endpoint; api: Endpoint; codex: { enabled: boolean }; claude: { enabled: boolean } };
export default function ProviderSettings({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/providers").then(async r => {
      if (!r.ok) throw new Error("Не удалось прочитать настройки");
      const data = await r.json(); if (live) setConfig(data);
    }).catch(e => { if (live) setStatus(e.message); });
    return () => { live = false; };
  }, []);
  if (!config) return <p role="status">{status || "Загружаем локальные настройки…"}</p>;
  const change = (id: "api" | "local", value: Partial<Endpoint>) => setConfig({ ...config, [id]: { ...config[id], ...value } });
  async function save() {
    if (!config) return;
    setBusy(true); setStatus("");
    try {
      const body = { ...config };
      for (const id of ["local", "api"] as const) {
        const { has_api_key: _, ...value } = body[id]; body[id] = value;
      }
      const r = await fetch("/api/providers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "Не удалось сохранить");
      setConfig(data); setStatus("Сохранено на этом компьютере. Узел обновит каталог в течение 10–30 секунд."); onSaved();
    } catch (e) { setStatus((e as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="local-provider-settings">
    <summary>Настроить API, локальную модель и CLI</summary>
    <p className="small-copy">Аккаунт FORMA не нужен. Выбери подключения, которыми хочешь пользоваться. Ключи сохраняются в локальном файле с доступом только для владельца.</p>
    <fieldset disabled={busy}>
      {([['local', 'Локальная модель'], ['api', 'Собственный API']] as const).map(([id, title]) => <section className="provider-config" key={id}>
        <label className="provider-toggle"><input type="checkbox" checked={config[id].enabled} onChange={e => change(id, { enabled: e.target.checked })} />{title}</label>
        <label className="field-label">Адрес {(id === "local" ? "локальной модели" : "API")}<input aria-label={`Адрес ${(id === "local" ? "локальной модели" : "API")}`} value={config[id].base_url} onChange={e => change(id, { base_url: e.target.value })} placeholder={id === 'local' ? 'http://127.0.0.1:11434/v1' : 'https://your-api.example/v1'} /></label>
        {id === 'local' && <div className="catalog-actions"><button className="text-button" onClick={() => change(id, { base_url: 'http://127.0.0.1:11434/v1' })}>Ollama</button><button className="text-button" onClick={() => change(id, { base_url: 'http://127.0.0.1:1234/v1' })}>LM Studio</button></div>}
        <label className="field-label">Модель вручную (необязательно)<input aria-label={`Модель ${(id === "local" ? "локальной модели" : "API")}`} value={config[id].model} onChange={e => change(id, { model: e.target.value })} placeholder="Идентификатор, если сервер не отдаёт каталог" /></label>
        <label className="field-label">Ключ {(id === "local" ? "локальной модели" : "API")}<input type="password" autoComplete="off" aria-label={`Ключ ${(id === "local" ? "локальной модели" : "API")}`} value={config[id].api_key} onChange={e => change(id, { api_key: e.target.value, clear_api_key: false })} placeholder={config[id].has_api_key ? 'Ключ сохранён · пустое поле оставит его' : 'Не нужен для большинства локальных серверов'} /></label>
        {config[id].has_api_key && <label className="provider-toggle"><input type="checkbox" checked={!!config[id].clear_api_key} onChange={e => change(id, { clear_api_key: e.target.checked })} />Удалить сохранённый ключ</label>}
        <p className="small-copy">{id === 'local' ? 'Запусти сервер в Ollama / LM Studio и загрузи модель. Поддерживаются /models и /chat/completions.' : 'Используется совместимый API /chat/completions. При смене адреса старый ключ удаляется; введи ключ нового сервера.'}</p>
      </section>)}
      <section className="provider-config">
        <strong>Авторизованные CLI · необязательно</strong>
        <p className="small-copy">Используются установленные на твоём компьютере CLI и их собственный вход. FORMA не запрашивает пароль от провайдера.</p>
        {(['codex', 'claude'] as const).map(id => <div key={id}>
          <label className="provider-toggle"><input type="checkbox" checked={config[id].enabled} onChange={e => setConfig({ ...config, [id]: { enabled: e.target.checked } })} />{id === 'codex' ? 'Codex CLI' : 'Claude Code'}</label>
          <code className="code-block">{id === 'codex' ? 'codex login' : 'npm run setup:claude\nclaude auth login'}</code>
        </div>)}
      </section>
      <button className="button primary full" onClick={() => void save()}>{busy ? 'Сохраняем…' : 'Сохранить подключения и обновить модели'}</button>
    </fieldset>
    {status && <p className="small-copy" role="status">{status}</p>}
  </details>;
}
