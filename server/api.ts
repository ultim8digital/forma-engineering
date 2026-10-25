import type { LocalBindings } from "./storage";
import { z } from "zod";
import { specSchema } from "../lib/contracts";
import { modelCatalogSchema, type ModelCatalog } from "../lib/engineering";
const ARTIFACTS = [
  "model.step",
  "model.stl",
  "mesh.json",
  "spec.json",
  "report.json",
  "source.py",
  "drawing.svg",
  "parts.zip",
  "bom.csv",
  "engineering.json",
  "strength-mesh.json",
  "drawings.pdf",
  "drawings.zip",
];
const json = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const sha = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const enqueue = z
  .object({
    prompt: z.string().max(12000).default(""),
    provider: z
      .enum(["manual", "codex", "claude", "api", "local"])
      .default("local"),
    model: z.string().max(160).default(""),
    spec: specSchema.optional(),
  })
  .refine(
    (v) => (v.provider === "manual" ? !!v.spec : v.prompt.trim().length > 0),
    "Нужны описание задачи или CAD-спецификация.",
  );
const uuid = () => crypto.randomUUID();
export function createApi(b: LocalBindings) {
return async function handler(r: Request, role: "user" | "worker" | "agent") {
  try {
    const url = new URL(r.url),
      p = url.pathname.replace(/^\/api\//, "").split("/"),
      now = Date.now();
    if (p[0] === "state" && r.method === "GET") {
      const [projects, nodes] = await Promise.all([
        b.DB.prepare(
          "SELECT * FROM projects ORDER BY updated_at DESC LIMIT 100",
        ).all(),
        b.DB.prepare(
          "SELECT * FROM nodes ORDER BY seen_at DESC LIMIT 10",
        ).all(),
      ]);
      return json({ projects: projects.results, nodes: nodes.results });
    }
    if (p[0] === "models") {
      if (r.method === "POST" && p[1] === "refresh") {
        await b.DB.prepare(
          "UPDATE nodes SET refresh_requested_at=? WHERE seen_at>?",
        )
          .bind(now, now - 45000)
          .run();
        return json({ requested_at: now }, 202);
      }
      if (r.method === "GET") {
        const node = await b.DB.prepare(
          "SELECT capabilities FROM nodes WHERE seen_at>? ORDER BY seen_at DESC LIMIT 1",
        )
          .bind(now - 45000)
          .first<{ capabilities: string }>();
        if (!node)
          return json(
            { error: "Нет подключённого узла. Каталог моделей недоступен." },
            503,
          );
        const catalog = JSON.parse(node.capabilities)
          .catalog as ModelCatalog | null;
        if (!catalog)
          return json({
            models: {},
            errors: {
              discovery:
                "Узел получает список моделей. Обнови через несколько секунд.",
            },
            discovered_at: 0,
          });
        const history = await b.DB.prepare(
          "SELECT provider,model,MAX(updated_at) AS verified_at FROM jobs WHERE status IN ('complete','needs_review') AND provider<>'manual' GROUP BY provider,model",
        ).all<{ provider: string; model: string; verified_at: number }>();
        for (const [provider, models] of Object.entries(catalog.models))
          for (const model of models) {
            const match = history.results.find(
              (h) => h.provider === provider && h.model === model.id,
            );
            if (match) {
              model.verified_at = match.verified_at;
              model.availability = "verified";
            }
          }
        return json(catalog);
      }
    }
    if (p[0] === "tokens" && role === "user") {
      if (r.method === "POST") {
        const token = "forma_" + uuid() + uuid().replaceAll("-", "");
        await b.DB.prepare(
          "INSERT INTO api_keys (hash,label,created_at) VALUES (?,?,?)",
        )
          .bind(await sha(token), "Agent API", now)
          .run();
        return json({ token }, 201);
      }
      if (r.method === "DELETE") {
        await b.DB.prepare("DELETE FROM api_keys").run();
        return json({ ok: true });
      }
    }
    if (p[0] === "projects") {
      if (r.method === "POST" && !p[1]) {
        const data = z
            .object({ title: z.string().trim().min(1).max(120) })
            .parse(await r.json()),
          id = uuid();
        await b.DB.prepare(
          "INSERT INTO projects(id,title,created_at,updated_at) VALUES (?,?,?,?)",
        )
          .bind(id, data.title, now, now)
          .run();
        return json({ id, title: data.title }, 201);
      }
      if (r.method === "GET" && p[1]) {
        const project = await b.DB.prepare("SELECT * FROM projects WHERE id=?")
          .bind(p[1])
          .first();
        if (!project) return json({ error: "Проект не найден" }, 404);
        const [revisions, jobs] = await Promise.all([
          b.DB.prepare(
            "SELECT * FROM revisions WHERE project_id=? ORDER BY created_at DESC LIMIT 40",
          )
            .bind(p[1])
            .all(),
          b.DB.prepare(
            "SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 20",
          )
            .bind(p[1])
            .all(),
        ]);
        return json({
          project,
          revisions: revisions.results,
          jobs: jobs.results,
        });
      }
      if (r.method === "POST" && p[1] && p[2] === "jobs") {
        const data = enqueue.parse(await r.json());
        if (data.provider !== "manual" && !data.model.trim()) return json({error: "Выбери или настрой модель в подключениях."}, 400);
        if (
          !(await b.DB.prepare("SELECT id FROM projects WHERE id=?")
            .bind(p[1])
            .first())
        )
          return json({ error: "Проект не найден" }, 404);
        const node = await b.DB.prepare(
          "SELECT seen_at,capabilities FROM nodes WHERE seen_at>? ORDER BY seen_at DESC LIMIT 1",
        )
          .bind(now - 45000)
          .first<{ seen_at: number; capabilities: string }>();
        if (!node)
          return json(
            {
              error:
                "Вычислительный узел не подключён. Запусти worker-node/runner.py.",
            },
            503,
          );
        const caps = JSON.parse(node.capabilities);
        if (caps.engineering_version !== 2)
          return json(
            { error: "Обнови CAD-узел до версии с поддержкой инженерных расчётов." },
            503,
          );
        if (
          data.provider !== "manual" &&
          !caps.providers?.includes(data.provider)
        )
          return json(
            { error: "Этот провайдер не настроен на вычислительном узле." },
            409,
          );
        if (
          data.provider !== "manual" &&
          caps.catalog?.models?.[data.provider]?.length &&
          !caps.catalog.models[data.provider].some(
            (m: { id: string }) => m.id === data.model,
          )
        )
          return json(
            {
              error:
                "Модель отсутствует в каталоге выбранного провайдера. Обнови список моделей.",
            },
            409,
          );
        const id = uuid(),
          out = await b.DB.prepare(
            "INSERT INTO jobs(id,project_id,prompt,provider,model,input_spec,status,stage,created_at,updated_at,attempts) SELECT ?,?,?,?,?,?,'queued','В очереди',?,?,0 WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))",
          )
            .bind(
              id,
              p[1],
              data.prompt,
              data.provider,
              data.model,
              data.spec ? JSON.stringify(data.spec) : null,
              now,
              now,
              p[1],
            )
            .run();
        if (!out.meta.changes)
          return json({ error: "У проекта уже есть активная задача." }, 409);
        return json({ id, status: "queued" }, 202);
      }
    }
    if (p[0] === "jobs" && p[1] && r.method === "GET")
      return json(
        await b.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(p[1]).first(),
      );
    if (p[0] === "artifacts" && r.method === "GET") {
      if (!ARTIFACTS.includes(p[2]))
        return json({ error: "Файл не найден" }, 404);
      const revision = await b.DB.prepare("SELECT id FROM revisions WHERE id=?")
        .bind(p[1])
        .first();
      if (!revision) return json({ error: "Версия не найдена" }, 404);
      const file = await b.BUCKET.get(`${p[1]}/${p[2]}`);
      if (!file) return json({ error: "Файл не найден" }, 404);
      const mime: Record<string, string> = {
        "mesh.json": "application/json",
        "spec.json": "application/json",
        "report.json": "application/json",
        "drawing.svg": "image/svg+xml",
        "source.py": "text/plain; charset=utf-8",
        "model.step": "application/step",
        "model.stl": "model/stl",
        "parts.zip": "application/zip",
        "bom.csv": "text/csv; charset=utf-8",
        "engineering.json": "application/json",
        "strength-mesh.json": "application/json",
        "drawings.pdf": "application/pdf",
        "drawings.zip": "application/zip",
      };
      return new Response(file.body, {
        headers: {
          "Content-Type": mime[p[2]],
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=60",
          ...(url.searchParams.has("download")
            ? { "Content-Disposition": `attachment; filename="neofab-${p[2]}"` }
            : {}),
        },
      });
    }
    if (p[0] === "worker" && role === "worker") {
      if (p[1] === "heartbeat" && r.method === "POST") {
        const d = z
          .object({
            id: z.string().max(80),
            name: z.string().max(120),
            capabilities: z.object({
              providers: z.array(z.string().max(60)).max(10),
              cad: z.string().max(80),
              engineering_version: z.number().int().optional(),
              catalog: modelCatalogSchema.nullable().optional(),
            }),
          })
          .parse(await r.json());
        await b.DB.prepare(
          "INSERT INTO nodes(id,name,capabilities,seen_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,capabilities=excluded.capabilities,seen_at=excluded.seen_at",
        )
          .bind(d.id, d.name, JSON.stringify(d.capabilities), now)
          .run();
        const control = await b.DB.prepare(
          "SELECT refresh_requested_at FROM nodes WHERE id=?",
        )
          .bind(d.id)
          .first<{ refresh_requested_at: number }>();
        return json({
          ok: true,
          refresh_models:
            (control?.refresh_requested_at || 0) >
            (d.capabilities.catalog?.discovered_at || 0),
        });
      }
      if (p[1] === "claim" && r.method === "POST") {
        await b.DB.prepare(
          "UPDATE jobs SET status='failed',error='Истекло время аренды вычислительного узла. Создай задачу повторно.',stage='Узел прервал работу',updated_at=? WHERE status='running' AND lease_until<?",
        )
          .bind(now, now)
          .run();
        const lease = uuid(),
          job = await b.DB.prepare(
            "UPDATE jobs SET status='running',stage='Подготовка',lease=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *",
          )
            .bind(lease, now + 600000, now)
            .first();
        return json({ job });
      }
      if (p[1] === "jobs" && p[2]) {
        const job = await b.DB.prepare(
          "SELECT * FROM jobs WHERE id=? AND lease=? AND status='running' AND lease_until>?",
        )
          .bind(p[2], r.headers.get("X-Job-Lease") || "", now)
          .first<{ id: string; project_id: string }>();
        if (!job) return json({ error: "Аренда задачи недействительна" }, 409);
        if (p[3] === "stage" && r.method === "POST") {
          const d = z
            .object({ stage: z.string().max(250) })
            .parse(await r.json());
          await b.DB.prepare(
            "UPDATE jobs SET stage=?,updated_at=?,lease_until=? WHERE id=?",
          )
            .bind(d.stage, now, now + 600000, job.id)
            .run();
          return json({ ok: true });
        }
        if (p[3] === "artifacts" && r.method === "PUT") {
          if (!ARTIFACTS.includes(p[4]))
            return json({ error: "Недопустимый файл" }, 400);
          const body = await r.arrayBuffer();
          if (body.byteLength > 15000000)
            return json({ error: "Файл больше 15 МБ" }, 413);
          await b.BUCKET.put(`${job.id}/${p[4]}`, body);
          return json({ ok: true });
        }
        if (p[3] === "finish" && r.method === "POST") {
          const d = z
            .object({
              spec: specSchema,
              report: z
                .object({
                  passed: z.boolean(),
                  checks: z.array(
                    z.object({
                      name: z.string(),
                      passed: z.boolean(),
                      detail: z.string(),
                    }),
                  ),
                  warnings: z.array(z.string()),
                })
                .passthrough(),
              provenance: z.object({
                provider: z.string(),
                model: z.string(),
                attempts: z.number(),
                elapsed_seconds: z.number(),
              }),
            })
            .parse(await r.json());
          for (const name of ARTIFACTS)
            if (!(await b.BUCKET.head(`${job.id}/${name}`)))
              return json({ error: `Не загружен ${name}` }, 409);
          const engineering = d.report.engineering as
            | {
                strength?: { status: string };
                motion?: { status: string };
                drawings?: { status: string };
              }
            | undefined;
          const inputs = d.spec.engineering;
          const analysisReview = !!(
            (inputs?.strength &&
              engineering?.strength?.status !== "within_limits") ||
            (inputs?.motion &&
              engineering?.motion?.status !== "sampled_clear") ||
            ((inputs?.manufacturing.general_tolerance_mm ||
              inputs?.manufacturing.dimensions.length) &&
              engineering?.drawings?.status !== "dimensioned_draft")
          );
          const status =
            d.report.passed && !analysisReview ? "complete" : "needs_review";
          await b.DB.batch([
            b.DB.prepare(
              "INSERT INTO revisions(id,project_id,job_id,spec,report,provenance,created_at) VALUES (?,?,?,?,?,?,?)",
            ).bind(
              job.id,
              job.project_id,
              job.id,
              JSON.stringify(d.spec),
              JSON.stringify(d.report),
              JSON.stringify(d.provenance),
              now,
            ),
            b.DB.prepare(
              "UPDATE projects SET current_revision=?,updated_at=? WHERE id=?",
            ).bind(job.id, now, job.project_id),
            b.DB.prepare(
              "UPDATE jobs SET status=?,stage=?,updated_at=? WHERE id=?",
            ).bind(
              status,
              status === "complete"
                ? "Построение и заданные проверки завершены"
                : "Есть замечания: открой отчёт",
              now,
              job.id,
            ),
          ]);
          return json({ ok: true });
        }
        if (p[3] === "fail" && r.method === "POST") {
          const d = z
            .object({ error: z.string().max(1500) })
            .parse(await r.json());
          await b.DB.prepare(
            "UPDATE jobs SET status='failed',error=?,stage='Не удалось построить',updated_at=? WHERE id=?",
          )
            .bind(d.error, now, job.id)
            .run();
          return json({ ok: true });
        }
      }
    }
    return json({ error: "Маршрут не найден" }, 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: "Некорректные данные", details: e.issues }, 400);
    if (e instanceof SyntaxError) return json({ error: "Некорректный JSON" }, 400);
    console.error("API error", e instanceof Error ? e.message : "unknown");
    return json(
      {
        error:
          "Ошибка сервиса. Проверь подключение хранилища и журнал сервера.",
      },
      500,
    );
  }
}
}
