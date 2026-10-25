import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

class Statement {
  constructor(readonly db: DatabaseSync, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.db, this.sql, values); }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
  execute() { return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.values).changes) } }; }
  async run() { return this.execute(); }
}

export class LocalDatabase {
  readonly db: DatabaseSync;
  constructor(folder: string, projectRoot: string) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const filename = path.join(folder, "forma.sqlite");
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)");
    for (const file of ["0000_past_thunderbolt_ross.sql", "0001_lumpy_venus.sql"]) {
      if (this.db.prepare("SELECT name FROM local_migrations WHERE name=?").get(file)) continue;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(readFileSync(path.join(projectRoot, "drizzle", file), "utf8"));
        this.db.prepare("INSERT INTO local_migrations(name) VALUES (?)").run(file);
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
  }
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = statements.map(s => s.execute());
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}

export class LocalFiles {
  constructor(readonly folder: string) { mkdirSync(folder, { recursive: true, mode: 0o700 }); }
  private filename(key: string) {
    if (!/^[a-f0-9-]{36}\/[a-z0-9.-]+$/.test(key)) throw new Error("Invalid artifact key");
    return path.join(this.folder, key);
  }
  async put(key: string, value: ArrayBuffer) {
    const target = this.filename(key);
    await import("node:fs/promises").then(fs => fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }));
    const temp = target + "." + randomUUID() + ".tmp";
    await writeFile(temp, Buffer.from(value), { mode: 0o600, flag: "wx" });
    await rename(temp, target);
  }
  async get(key: string) {
    try { return { body: new Uint8Array(await readFile(this.filename(key))) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async head(key: string) {
    try { return await stat(this.filename(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
}
export type LocalBindings = { DB: LocalDatabase; BUCKET: LocalFiles };
