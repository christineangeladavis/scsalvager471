import { describe, it, expect } from "vitest";
import { explainDmFailure } from "../_lib/discordBot.js";

describe("explainDmFailure", () => {
  it("returns null for ok=true", () => {
    expect(explainDmFailure({ ok: true })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(explainDmFailure(null)).toBeNull();
    expect(explainDmFailure(undefined)).toBeNull();
  });

  it("explains code 50007 (DMs disabled)", () => {
    const msg = explainDmFailure({ ok: false, code: 50007, status: 403 });
    expect(msg).toBeTruthy();
    expect(msg.toLowerCase()).toContain("dm");
  });

  it("explains 403 status", () => {
    const msg = explainDmFailure({ ok: false, code: 0, status: 403 });
    expect(msg).toBeTruthy();
    expect(msg.toLowerCase()).toContain("forbidden");
  });

  it("explains 401 status", () => {
    const msg = explainDmFailure({ ok: false, code: 0, status: 401 });
    expect(msg).toBeTruthy();
    expect(msg.toLowerCase()).toContain("token");
  });

  it("explains 429 status", () => {
    const msg = explainDmFailure({ ok: false, code: 0, status: 429 });
    expect(msg).toBeTruthy();
    expect(msg.toLowerCase()).toContain("rate");
  });

  it("returns null for unknown error codes", () => {
    expect(explainDmFailure({ ok: false, code: 99999, status: 500 })).toBeNull();
  });
});
