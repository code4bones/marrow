import { describe, expect, it } from "vitest";
import { createProjectSchema } from "../src/features/projects/model/schema.js";
import { projectSlugProblem } from "../src/features/projects/model/slug.js";
import { artifactStoragePath } from "../src/gateway/pg-tool-service/formatters/artifacts.js";

// T-MEMORY-169: the slug is a directory name under ARTIFACT_DIR.
describe("project slug", () => {
  it.each([
    "marrow", "original_eheart", "enigma2-skin-designer", "gi-et11000", "SCORMv1", "a", "x".repeat(63)
  ])("accepts %s (every slug that exists today, and plain new ones)", (slug) => {
    expect(projectSlugProblem(slug)).toBeNull();
    expect(createProjectSchema.safeParse({ slug, title: "t" }).success).toBe(true);
  });

  it.each([
    ".", "..", "../x", "a/b", "victim-slug/docs", "zz/../victim", "a\\b", "-lead", "_lead", "with space",
    "dot.dot", "", "x".repeat(64), "common", "Common", "COMMON", "nul\0byte", "тест"
  ])("rejects %j", (slug) => {
    expect(projectSlugProblem(slug)).not.toBeNull();
    expect(createProjectSchema.safeParse({ slug, title: "t" }).success).toBe(false);
  });

  it("artifactStoragePath keeps normal slugs and the common namespace", () => {
    expect(artifactStoragePath("marrow", "docs/a.md")).toBe("marrow/docs/a.md");
    expect(artifactStoragePath(null, "docs/a.md")).toBe("common/docs/a.md");
  });

  it("artifactStoragePath refuses a slug that could leave its own directory", () => {
    for (const slug of [".", "..", "a/b", "x/..", "victim/docs", "common"]) {
      expect(() => artifactStoragePath(slug, "plan.md"), slug).toThrow();
    }
  });
});
