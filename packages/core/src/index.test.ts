import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@silo/core placeholder", () => {
  it("exports a defined marker", () => {
    expect(name).toBeDefined();
    expect(name).toBe("@silo/core");
  });
});
