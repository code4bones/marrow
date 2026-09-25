import { describe, expect, it } from "vitest";
import { graphqlDocumentTier } from "../src/gateway/graphql-scope.js";

const ADMIN = ["updateCreditSettings", "setGitVariable", "deleteGitVariable", "triggerGitPipeline"] as const;
const tier = (q: string) => graphqlDocumentTier(q, ADMIN);

// T-MEMORY-166: the admin gate must survive tokens GraphQL ignores.
describe("graphqlDocumentTier", () => {
  it("classifies plain reads and writes", () => {
    expect(tier("{ projects { id } }")).toBe("read");
    expect(tier("query Q { tasks { id } }")).toBe("read");
    expect(tier("subscription { eventAdded { id } }")).toBe("read");
    expect(tier('mutation { createLink(input: {fromId: "a", toId: "b", relation: "x"}) { id } }')).toBe("write");
  });

  it.each([
    'mutation { setGitVariable(host:"h",project:"p",key:"k",value:"v") }',
    'mutation { setGitVariable ,(host:"h",project:"p",key:"k",value:"v") }',
    'mutation { setGitVariable,(host:"h") }',
    'mutation { triggerGitPipeline #c\n(host:"h",project:"p",ref:"main") }',
    "mutation { updateCreditSettings ,(enabled:true){enabled} }",
    "mutation { updateCreditSettings\n\n(enabled:true){enabled} }",
    "mutation { ﻿deleteGitVariable(host:\"h\") }",
    'mutation { x: setGitVariable(host:"h") }',
    'mutation { ...F } fragment F on Mutation { setGitVariable(host:"h") }',
    'mutation { ... on Mutation { triggerGitPipeline(host:"h") } }',
    'mutation A { createLink(input:{}) { id } } mutation B { deleteGitVariable(host:"h") }',
    'mutation { ...A } fragment A on Mutation { ...B } fragment B on Mutation { setGitVariable(host:"h") }'
  ])("requires admin for %s", (q) => {
    expect(tier(q)).toBe("admin");
  });

  it("does not flag admin names appearing only as arguments, strings or comments", () => {
    expect(tier('mutation { createLink(input:{relation:"setGitVariable"}) { id } }')).toBe("write");
    expect(tier("# setGitVariable(\n{ projects { id } }")).toBe("read");
  });

  it("falls back conservatively on unparseable text", () => {
    expect(tier("mutation { setGitVariable(")).toBe("admin");
    expect(tier("mutation {")).toBe("write");
    expect(tier("{ projects")).toBe("read");
  });
});
