import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, readSettings } from "./settings.js";

describe("readSettings", () => {
  it("uses defaults", () => {
    const got = readSettings(undefined);
    expect(got).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps quorum values to team size", () => {
    const got = readSettings({ teamSize: 2, minParticipatingAgents: 9, minAnsweringAgents: 7 });
    expect(got.teamSize).toBe(2);
    expect(got.minParticipatingAgents).toBe(2);
    expect(got.minAnsweringAgents).toBe(2);
  });

  it("accepts strategy overrides", () => {
    const got = readSettings({ strategy: "debate", enabled: true });
    expect(got.strategy).toBe("debate");
    expect(got.enabled).toBe(true);
  });
});
