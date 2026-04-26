import { describe, it, expect } from "vitest";
import { median, buildPublicView } from "../prices.js";

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the value for a single element", () => {
    expect(median([42])).toBe(42);
  });

  it("returns the middle value for odd-length arrays", () => {
    expect(median([1, 3, 5])).toBe(3);
    expect(median([5, 1, 3])).toBe(3); // should sort
  });

  it("returns the average of the two middle values for even-length arrays", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });

  it("handles duplicates", () => {
    expect(median([5, 5, 5])).toBe(5);
  });
});

describe("buildPublicView", () => {
  it("returns empty object for null/empty input", () => {
    expect(buildPublicView(null)).toEqual({});
    expect(buildPublicView({})).toEqual({});
  });

  it("skips entries with no reports", () => {
    const result = buildPublicView({
      "Lorville": { reports: [] },
    });
    expect(result).not.toHaveProperty("Lorville");
  });

  it("builds correct public view for a location", () => {
    const now = Date.now();
    const result = buildPublicView({
      "Lorville": {
        reports: [
          { price: 1000, ts: now - 2000 },
          { price: 2000, ts: now - 1000 },
          { price: 3000, ts: now },
        ],
      },
    });
    expect(result["Lorville"].medianPrice).toBe(2000);
    expect(result["Lorville"].reportCount).toBe(3);
    expect(result["Lorville"].lastReportedAt).toBe(now);
  });

  it("uses the most recent timestamp as lastReportedAt", () => {
    const ts1 = 1000;
    const ts2 = 9000;
    const result = buildPublicView({
      "Port Olisar": {
        reports: [
          { price: 500, ts: ts1 },
          { price: 600, ts: ts2 },
        ],
      },
    });
    expect(result["Port Olisar"].lastReportedAt).toBe(ts2);
  });

  it("skips entries where all reports have non-numeric prices", () => {
    const result = buildPublicView({
      "Bad Location": {
        reports: [
          { price: "notanumber", ts: 1000 },
          { price: null, ts: 2000 },
        ],
      },
    });
    expect(result).not.toHaveProperty("Bad Location");
  });
});
