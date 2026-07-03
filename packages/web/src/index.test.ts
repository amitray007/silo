import { describe, expect, it } from "vitest";
import { coreDependencyName, name } from "./index.js";

describe("@silo/web placeholder", () => {
  it("exports a defined marker", () => {
    expect(name).toBeDefined();
    expect(name).toBe("@silo/web");
  });

  it("resolves the @silo/core workspace link", () => {
    expect(coreDependencyName).toBe("@silo/core");
  });
});
