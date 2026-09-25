import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_GRAPHQL_MUTATION_NAMES } from "../src/gateway/graphql.js";
import { gatewayToolSpecs } from "../src/gateway/tool-definitions.js";

// GraphQL resolvers reach tools through callTool(), which does NOT re-check a
// tool's access tier (the MCP/REST path does). Every admin-tier tool a resolver
// can reach must therefore be guarded some other way -- otherwise a role=member
// caller gets it through GraphQL. Today that is:
//   - the four admin MUTATIONS, classified by the parsed-document gate
//     (graphql-scope.ts, ADMIN_GRAPHQL_MUTATION_NAMES);
//   - gateway.diagnostics, refused to members inside its implementation.
// This test fails when a resolver starts reaching a NEW admin-tier tool, so the
// author has to add a guard (and list it here) instead of shipping the hole.
const MUTATION_TO_TOOL: Record<(typeof ADMIN_GRAPHQL_MUTATION_NAMES)[number], string> = {
  updateCreditSettings: "credit.settings_update",
  setGitVariable: "git.variable_set",
  deleteGitVariable: "git.variable_delete",
  triggerGitPipeline: "git.pipeline_trigger"
};
const GUARDED_IN_IMPLEMENTATION = new Set(["gateway.diagnostics"]);

describe("admin-tier tools reachable through GraphQL", () => {
  const source = readFileSync(new URL("../src/gateway/graphql.ts", import.meta.url), "utf8");
  const reached = new Set([...source.matchAll(/callTool<[^>]*>\(\s*context,\s*"([a-z_.]+)"/g)].map((match) => match[1]));
  const adminTools = new Set(gatewayToolSpecs.filter((spec) => spec.access === "admin").map((spec) => spec.name));
  const reachedAdmin = [...reached].filter((name) => adminTools.has(name));

  it("finds the resolvers' tool calls (guards against the regex silently matching nothing)", () => {
    expect(reached.size).toBeGreaterThan(50);
    expect(reached.has("task.list")).toBe(true);
  });

  it("every admin-tier tool a resolver reaches is guarded", () => {
    const guarded = new Set([...Object.values(MUTATION_TO_TOOL), ...GUARDED_IN_IMPLEMENTATION]);
    const unguarded = reachedAdmin.filter((name) => !guarded.has(name));
    expect(unguarded, `GraphQL reaches admin-tier tools with no guard: ${unguarded.join(", ")}`).toEqual([]);
  });

  it("the mutation gate list and this mapping stay in sync", () => {
    expect(Object.keys(MUTATION_TO_TOOL).sort()).toEqual([...ADMIN_GRAPHQL_MUTATION_NAMES].sort());
    for (const tool of Object.values(MUTATION_TO_TOOL)) {
      expect(adminTools.has(tool), `${tool} should still be admin-tier`).toBe(true);
    }
  });
});
