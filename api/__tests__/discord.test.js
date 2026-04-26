import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl } from "../_lib/discord.js";

describe("buildAuthorizeUrl", () => {
  const base = {
    clientId: "123456",
    redirectUri: "https://example.com/api/auth/callback",
    state: "randomstate",
  };

  it("includes required OAuth params", () => {
    const url = new URL(buildAuthorizeUrl(base));
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/api/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("randomstate");
  });

  it("defaults scope to 'identify'", () => {
    const url = new URL(buildAuthorizeUrl(base));
    expect(url.searchParams.get("scope")).toBe("identify");
  });

  it("accepts a custom scope", () => {
    const url = new URL(buildAuthorizeUrl({ ...base, scope: "identify applications.commands" }));
    expect(url.searchParams.get("scope")).toBe("identify applications.commands");
  });

  it("defaults prompt to 'none'", () => {
    const url = new URL(buildAuthorizeUrl(base));
    expect(url.searchParams.get("prompt")).toBe("none");
  });

  it("accepts a custom prompt", () => {
    const url = new URL(buildAuthorizeUrl({ ...base, prompt: "consent" }));
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("forwards extra params", () => {
    const url = new URL(buildAuthorizeUrl({ ...base, extra: { integration_type: 1 } }));
    expect(url.searchParams.get("integration_type")).toBe("1");
  });

  it("skips extra params that are null/undefined", () => {
    const url = new URL(buildAuthorizeUrl({ ...base, extra: { foo: null, bar: undefined } }));
    expect(url.searchParams.has("foo")).toBe(false);
    expect(url.searchParams.has("bar")).toBe(false);
  });

  it("points to the Discord OAuth authorize endpoint", () => {
    const url = new URL(buildAuthorizeUrl(base));
    expect(url.hostname).toBe("discord.com");
    expect(url.pathname).toBe("/api/oauth2/authorize");
  });
});
