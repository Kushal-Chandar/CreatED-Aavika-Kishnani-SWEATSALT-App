import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { appendEntry, pruneOldEntries, queryEntries } from "./logStore";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("logStore", () => {
  beforeEach(async () => {
    indexedDB.deleteDatabase("sweatsalt-log");
  });

  it("appends and queries entries", async () => {
    await appendEntry({ source: "gsr", value: 5.2, ts: Date.now() });
    const entries = await queryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("gsr");
  });

  it("prunes entries older than 14 days, keeps recent ones", async () => {
    const now = Date.now();
    await appendEntry({ source: "hr", value: 80, ts: now - 20 * DAY_MS });
    await appendEntry({ source: "hr", value: 82, ts: now - 1 * DAY_MS });

    await pruneOldEntries(now);
    const entries = await queryEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe(82);
  });
});
