import * as z from "zod/v4";

// A project slug is used as a directory name under ARTIFACT_DIR
// (artifactStoragePath) as well as in URLs, so it must be ONE plain path
// segment: no "/", "\", ".", "..", spaces or control characters. The old
// schema only required min(1), which let a member create a project with slug
// "victim/docs", "." or "common" and write artifacts into another project's
// (or the shared common) directory (SEC-5). Letters, digits, "-" and "_" cover
// every slug in use today (including the one upper-case "SCORMv1").

export const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

// Directory names artifacts storage already uses for something else.
const RESERVED_PROJECT_SLUGS = new Set(["common"]);

// Existing artifact storage paths must remain readable after naming rules
// tighten. Only filesystem safety belongs in this check.
export function projectSlugStorageProblem(slug: string): string | null {
  if (!PROJECT_SLUG_PATTERN.test(slug)) {
    return "Project slug must be 1-63 characters: letters, digits, '-' and '_', starting with a letter or digit.";
  }
  if (RESERVED_PROJECT_SLUGS.has(slug.toLowerCase())) {
    return `Project slug "${slug}" is reserved.`;
  }
  return null;
}

export function projectSlugProblem(slug: string): string | null {
  const storageProblem = projectSlugStorageProblem(slug);
  if (storageProblem) return storageProblem;
  if (/^p-/i.test(slug)) {
    const suggested = slug.slice(2).toLowerCase() || "my-project";
    return `Project slug cannot start with "P-" (case-insensitive): that prefix is reserved for project IDs. Use slug "${suggested}" instead; the project ID is generated automatically.`;
  }
  return null;
}

export const projectSlugSchema = z.string().superRefine((slug, ctx) => {
  const problem = projectSlugProblem(slug);
  if (problem) {
    ctx.addIssue({ code: "custom", message: problem });
  }
}).describe('Project slug, for example "frappe-cicd". Never pass a project ID such as "P-FRAPPE-CICD" here: the P- prefix is reserved (case-insensitive). The server generates the project ID.');
