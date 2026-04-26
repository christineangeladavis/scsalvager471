import { describe, it, expect } from "vitest";
import { defaultPrefs, sanitizePrefsUpdate } from "../_lib/prefs.js";

describe("defaultPrefs", () => {
  it("returns expected defaults", () => {
    const prefs = defaultPrefs();
    expect(prefs.discordNotifications).toBe(false);
    expect(prefs.notificationLinkedAt).toBeNull();
  });

  it("returns a new object each call", () => {
    expect(defaultPrefs()).not.toBe(defaultPrefs());
  });
});

describe("sanitizePrefsUpdate", () => {
  it("accepts valid discordNotifications boolean", () => {
    expect(sanitizePrefsUpdate({ discordNotifications: true })).toEqual({ discordNotifications: true });
    expect(sanitizePrefsUpdate({ discordNotifications: false })).toEqual({ discordNotifications: false });
  });

  it("rejects non-boolean discordNotifications", () => {
    expect(sanitizePrefsUpdate({ discordNotifications: "true" })).toEqual({});
    expect(sanitizePrefsUpdate({ discordNotifications: 1 })).toEqual({});
    expect(sanitizePrefsUpdate({ discordNotifications: null })).toEqual({});
  });

  it("drops unknown fields", () => {
    expect(sanitizePrefsUpdate({ unknown: "value", foo: 123 })).toEqual({});
  });

  it("clients cannot set notificationLinkedAt", () => {
    const result = sanitizePrefsUpdate({ notificationLinkedAt: Date.now() });
    expect(result).not.toHaveProperty("notificationLinkedAt");
  });

  it("returns empty object for null/non-object input", () => {
    expect(sanitizePrefsUpdate(null)).toEqual({});
    expect(sanitizePrefsUpdate("string")).toEqual({});
    expect(sanitizePrefsUpdate(42)).toEqual({});
  });
});
