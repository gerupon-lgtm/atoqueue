import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("001 initial PostgreSQL schema", () => {
  it("declares notification tables, relationship, and required indexes", async () => {
    const sql = await readFile(new URL("./001_initial.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS device_subscriptions/i);
    expect(sql).toMatch(/device_id TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS reminder_jobs/i);
    expect(sql).toMatch(/FOREIGN KEY \(device_id\) REFERENCES device_subscriptions\(device_id\)/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_reminder_jobs_due\s+ON reminder_jobs\(status, scheduled_at\)/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_jobs_idempotency\s+ON reminder_jobs\(device_id, idempotency_key\)/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS device_idempotency_operations/i);
    expect(sql).not.toMatch(/sqlite|pragma|wal/i);
  });
});
