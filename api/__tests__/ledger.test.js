import { describe, it, expect } from "vitest";
import { sanitizeRefineryJob, sanitizeSellOrder } from "../ledger.js";

const validJob = {
  id: "job-123",
  material: "Construction Salvage",
  location: "Levski",
  method: "Cormack Method",
  materialScu: 240,
  yield: 36,
  cost: 1919,
  timeMinutes: 960,
  submittedAt: 1700000000000,
  completesAt: 1700057600000,
  pickedUpAt: null,
  notifiedAt: null,
  notificationStatus: null,
  notificationMessageId: null,
};

const validOrder = {
  id: "order-456",
  scu: 36,
  location: "Lorville",
  aUEC: 72000,
  submittedAt: 1700000000000,
};

describe("sanitizeRefineryJob", () => {
  it("returns a clean object for valid input", () => {
    const result = sanitizeRefineryJob(validJob);
    expect(result).not.toBeNull();
    expect(result.id).toBe("job-123");
    expect(result.material).toBe("Construction Salvage");
  });

  it("returns null for null/non-object input", () => {
    expect(sanitizeRefineryJob(null)).toBeNull();
    expect(sanitizeRefineryJob("string")).toBeNull();
    expect(sanitizeRefineryJob(42)).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(sanitizeRefineryJob({ ...validJob, id: "" })).toBeNull();
  });

  it("returns null when material is missing", () => {
    expect(sanitizeRefineryJob({ ...validJob, material: "" })).toBeNull();
  });

  it("returns null when yield is not a finite number", () => {
    expect(sanitizeRefineryJob({ ...validJob, yield: NaN })).toBeNull();
    expect(sanitizeRefineryJob({ ...validJob, yield: Infinity })).toBeNull();
    expect(sanitizeRefineryJob({ ...validJob, yield: "bad" })).toBeNull();
  });

  it("returns null when submittedAt or completesAt is not finite", () => {
    expect(sanitizeRefineryJob({ ...validJob, submittedAt: NaN })).toBeNull();
    expect(sanitizeRefineryJob({ ...validJob, completesAt: NaN })).toBeNull();
  });

  it("truncates string fields to max length", () => {
    const longString = "x".repeat(200);
    const result = sanitizeRefineryJob({ ...validJob, id: longString, material: longString });
    expect(result.id.length).toBeLessThanOrEqual(80);
    expect(result.material.length).toBeLessThanOrEqual(80);
  });

  it("sets pickedUpAt to null for invalid values", () => {
    const result = sanitizeRefineryJob({ ...validJob, pickedUpAt: NaN });
    expect(result.pickedUpAt).toBeNull();
  });

  it("omits optional location/method fields when not provided", () => {
    const { location, method, materialScu, ...rest } = validJob;
    const result = sanitizeRefineryJob(rest);
    expect(result).not.toHaveProperty("location");
    expect(result).not.toHaveProperty("method");
    expect(result).not.toHaveProperty("materialScu");
  });

  it("preserves notification bookkeeping fields", () => {
    const result = sanitizeRefineryJob({
      ...validJob,
      notifiedAt: 1700000001000,
      notificationStatus: "sent",
      notificationMessageId: "msg-abc",
    });
    expect(result.notifiedAt).toBe(1700000001000);
    expect(result.notificationStatus).toBe("sent");
    expect(result.notificationMessageId).toBe("msg-abc");
  });
});

describe("sanitizeSellOrder", () => {
  it("returns a clean object for valid input", () => {
    const result = sanitizeSellOrder(validOrder);
    expect(result).not.toBeNull();
    expect(result.id).toBe("order-456");
    expect(result.location).toBe("Lorville");
  });

  it("returns null for null/non-object input", () => {
    expect(sanitizeSellOrder(null)).toBeNull();
    expect(sanitizeSellOrder("string")).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(sanitizeSellOrder({ ...validOrder, id: "" })).toBeNull();
  });

  it("returns null when location is missing", () => {
    expect(sanitizeSellOrder({ ...validOrder, location: "" })).toBeNull();
  });

  it("returns null when scu or aUEC is not finite", () => {
    expect(sanitizeSellOrder({ ...validOrder, scu: NaN })).toBeNull();
    expect(sanitizeSellOrder({ ...validOrder, aUEC: Infinity })).toBeNull();
  });

  it("returns null when submittedAt is not finite", () => {
    expect(sanitizeSellOrder({ ...validOrder, submittedAt: NaN })).toBeNull();
  });

  it("truncates id to 80 chars and location to 120 chars", () => {
    const result = sanitizeSellOrder({
      ...validOrder,
      id: "x".repeat(200),
      location: "y".repeat(200),
    });
    expect(result.id.length).toBeLessThanOrEqual(80);
    expect(result.location.length).toBeLessThanOrEqual(120);
  });
});
