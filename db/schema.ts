import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  currentRevision: text("current_revision"),
});
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    prompt: text("prompt").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputSpec: text("input_spec"),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lease: text("lease"),
    leaseUntil: integer("lease_until"),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [index("jobs_queue").on(t.status, t.createdAt)],
);
export const revisions = sqliteTable("revisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  jobId: text("job_id").notNull(),
  spec: text("spec").notNull(),
  report: text("report").notNull(),
  provenance: text("provenance").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  capabilities: text("capabilities").notNull(),
  seenAt: integer("seen_at").notNull(),
  refreshRequestedAt: integer("refresh_requested_at").notNull().default(0),
});
export const apiKeys = sqliteTable("api_keys", {
  hash: text("hash").primaryKey(),
  label: text("label").notNull(),
  createdAt: integer("created_at").notNull(),
});
