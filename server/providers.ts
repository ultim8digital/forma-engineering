import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const endpoint = z.string().trim().max(1000).refine(value => {
  if (!value) return true;
  try {
    const u = new URL(value);
    return !u.username && !u.password && !u.search && !u.hash &&
      (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
  } catch { return false; }
}, "Нужен HTTPS-адрес API или HTTP на localhost, без пароля и параметров в URL.");
const profile = z.object({
  enabled: z.boolean(), base_url: endpoint, model: z.string().trim().max(160),
  api_key: z.string().max(4000).default(""), clear_api_key: z.boolean().optional(),
}).strict().refine(p => !p.enabled || !!p.base_url, "Укажи адрес сервера модели.");
export const providerSchema = z.object({
  local: profile, api: profile,
  codex: z.object({ enabled: z.boolean() }).strict(),
  claude: z.object({ enabled: z.boolean() }).strict(),
}).strict();
export type ProviderConfig = z.infer<typeof providerSchema>;
const defaults: ProviderConfig = {
  local: { enabled: false, base_url: "http://127.0.0.1:11434/v1", model: "", api_key: "" },
  api: { enabled: false, base_url: "", model: "", api_key: "" },
  codex: { enabled: false }, claude: { enabled: false },
};

export class ProviderSettings {
  readonly filename: string;
  constructor(folder: string) { this.filename = path.join(folder, "providers.json"); }
  read(): ProviderConfig {
    return existsSync(this.filename) ? providerSchema.parse(JSON.parse(readFileSync(this.filename, "utf8"))) : structuredClone(defaults);
  }
  publicConfig() {
    const config = this.read();
    return { ...config,
      local: { ...config.local, api_key: "", has_api_key: !!config.local.api_key },
      api: { ...config.api, api_key: "", has_api_key: !!config.api.api_key },
    };
  }
  save(value: unknown) {
    const next = providerSchema.parse(value), prior = this.read();
    for (const id of ["api", "local"] as const) {
      // A previously saved secret must never silently travel to a different endpoint.
      next[id].api_key = next[id].clear_api_key ? "" : next[id].api_key ||
        (prior[id].base_url === next[id].base_url ? prior[id].api_key : "");
      delete next[id].clear_api_key;
    }
    const temp = this.filename + "." + randomUUID() + ".tmp";
    writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temp, this.filename);
    return this.publicConfig();
  }
}
