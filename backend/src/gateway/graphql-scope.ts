import { Kind, parse, type FragmentDefinitionNode, type SelectionSetNode } from "graphql";

// Which scope tier a GraphQL document needs, decided from the parsed AST
// rather than from the raw text. The previous text regex (`name\s*\(`) was
// bypassed by tokens GraphQL ignores -- a comma or a `#` comment between the
// field name and its arguments -- so a write-tier caller could reach the
// admin-tier mutations (SEC-2). Anything that cannot be parsed falls back to
// a deliberately loose textual check that can only over-require scope.

export type GraphqlTier = "read" | "write" | "admin";

function rootFieldNames(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  seenFragments: Set<string>
): string[] {
  const names: string[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      // The schema field name, never the alias.
      names.push(selection.name.value);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      names.push(...rootFieldNames(selection.selectionSet, fragments, seenFragments));
    } else {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (fragment && !seenFragments.has(name)) {
        seenFragments.add(name);
        names.push(...rootFieldNames(fragment.selectionSet, fragments, seenFragments));
      }
    }
  }
  return names;
}

export function graphqlDocumentTier(query: string, adminMutationNames: readonly string[]): GraphqlTier {
  let document;
  try {
    document = parse(query, { noLocation: true });
  } catch {
    // Unparseable text is rejected by the GraphQL engine anyway; stay
    // conservative in case another parser reads it differently.
    if (adminMutationNames.some((name) => query.includes(name))) {
      return "admin";
    }
    return /\bmutation\b/i.test(query) ? "write" : "read";
  }

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  const admin = new Set(adminMutationNames);
  let tier: GraphqlTier = "read";
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION || definition.operation !== "mutation") {
      continue;
    }
    tier = "write";
    const roots = rootFieldNames(definition.selectionSet, fragments, new Set());
    if (roots.some((name) => admin.has(name))) {
      return "admin";
    }
  }
  return tier;
}
