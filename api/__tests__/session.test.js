import { describe, it, expect } from "vitest";
import { parseCookies, buildCookie, generateToken } from "../_lib/session.js";

describe("parseCookies", () => {
  it("returns empty object for null/undefined header", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookies("name=value")).toEqual({ name: "value" });
  });

  it("parses multiple cookies", () => {
    expect(parseCookies("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("decodes URL-encoded values", () => {
    const result = parseCookies("token=hello%20world");
    expect(result.token).toBe("hello world");
  });

  it("handles values with = signs", () => {
    const result = parseCookies("token=abc=def=ghi");
    expect(result.token).toBe("abc=def=ghi");
  });

  it("trims whitespace around names and values", () => {
    expect(parseCookies("  name  =  value  ")).toEqual({ name: "value" });
  });
});

describe("buildCookie", () => {
  it("includes name, value, Path, and SameSite by default", () => {
    const cookie = buildCookie("test", "val");
    expect(cookie).toContain("test=val");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("includes HttpOnly by default", () => {
    expect(buildCookie("a", "b")).toContain("HttpOnly");
  });

  it("omits HttpOnly when httpOnly=false", () => {
    expect(buildCookie("a", "b", { httpOnly: false })).not.toContain("HttpOnly");
  });

  it("includes Max-Age when provided", () => {
    expect(buildCookie("a", "b", { maxAge: 3600 })).toContain("Max-Age=3600");
  });

  it("omits Max-Age when not provided", () => {
    expect(buildCookie("a", "b")).not.toContain("Max-Age");
  });

  it("URL-encodes the cookie value", () => {
    const cookie = buildCookie("tok", "hello world");
    expect(cookie).toContain("tok=hello%20world");
  });

  it("respects custom sameSite", () => {
    expect(buildCookie("a", "b", { sameSite: "Strict" })).toContain("SameSite=Strict");
  });
});

describe("generateToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 20 }, generateToken));
    expect(tokens.size).toBe(20);
  });
});
