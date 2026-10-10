import { describe, expect, it } from "vitest";
import { decideSync } from "./prefsMerge";

const facts = { serverAt: 0, syncedAt: 0, changedAt: 0, hasLocalValues: false };

describe("decideSync", () => {
  it("applies a server copy newer than the last sync", () => {
    expect(decideSync({ ...facts, serverAt: 5000, syncedAt: 4000 })).toBe("apply");
    expect(decideSync({ ...facts, serverAt: 5000 })).toBe("apply");
  });

  it("applies the server copy to a device whose own choices were never synced", () => {
    expect(decideSync({ ...facts, serverAt: 5000, hasLocalValues: true })).toBe("apply");
  });

  it("does nothing when both sides agree", () => {
    expect(decideSync({ ...facts, serverAt: 5000, syncedAt: 5000, hasLocalValues: true })).toBe(
      "none",
    );
    expect(decideSync(facts)).toBe("none");
  });

  it("pushes a local change the server has not seen", () => {
    expect(decideSync({ ...facts, serverAt: 4000, syncedAt: 4000, changedAt: 4500 })).toBe(
      "push",
    );
    expect(decideSync({ ...facts, changedAt: 4500, hasLocalValues: true })).toBe("push");
  });

  it("lets the later write win when both sides changed", () => {
    const both = { ...facts, syncedAt: 3000, hasLocalValues: true };
    expect(decideSync({ ...both, serverAt: 6000, changedAt: 5000 })).toBe("apply");
    expect(decideSync({ ...both, serverAt: 5000, changedAt: 6000 })).toBe("push");
  });

  it("seeds an empty server from a device that already has choices", () => {
    expect(decideSync({ ...facts, hasLocalValues: true })).toBe("push");
  });

  it("does not seed the server with defaults", () => {
    expect(decideSync({ ...facts, serverAt: 0, hasLocalValues: false })).toBe("none");
  });

  it("restores a server that fell behind, such as one restored from a backup", () => {
    expect(decideSync({ ...facts, serverAt: 2000, syncedAt: 5000, hasLocalValues: true })).toBe(
      "push",
    );
    expect(decideSync({ ...facts, serverAt: 2000, syncedAt: 5000 })).toBe("none");
  });
});
