import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Knex } from "knex";
import { createPgKnex } from "../src/shared/pg/knex.js";

type TemplateSeed = {
  source: string;
  artifactPath: string;
  title: string;
  description: string;
  tags: string[];
};

type SeedTemplatesOptions = {
  db?: Knex;
  packageRoot?: string;
  clientId?: string;
  log?: (message: string) => void;
};

type SeedTemplatesResult = {
  created: number;
  updated: number;
  unchanged: number;
  templates: number;
};

const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

const templateSeeds: TemplateSeed[] = [
  {
    source: "docs/templates/agents/generic/AGENTS.md",
    artifactPath: "templates/agents/generic/AGENTS.md",
    title: "Generic AGENTS.md Template",
    description: "Reusable project-level agent instructions for a generic software repository.",
    tags: ["template", "agents", "generic", "markdown"]
  },
  {
    source: "docs/templates/agents/frontend/AGENTS.md",
    artifactPath: "templates/agents/frontend/AGENTS.md",
    title: "Frontend AGENTS.md Template",
    description: "Reusable agent instructions for frontend and web application repositories.",
    tags: ["template", "agents", "frontend", "markdown"]
  },
  {
    source: "docs/templates/agents/backend/AGENTS.md",
    artifactPath: "templates/agents/backend/AGENTS.md",
    title: "Backend AGENTS.md Template",
    description: "Reusable agent instructions for backend services, APIs, workers, and CLIs.",
    tags: ["template", "agents", "backend", "markdown"]
  },
  {
    source: "docs/templates/agents/devops/AGENTS.md",
    artifactPath: "templates/agents/devops/AGENTS.md",
    title: "DevOps AGENTS.md Template",
    description: "Reusable agent instructions for deployment and operations repositories.",
    tags: ["template", "agents", "devops", "ops", "markdown"]
  },
  {
    source: "docs/templates/review/REVIEW_CHECKLIST.md",
    artifactPath: "templates/review/REVIEW_CHECKLIST.md",
    title: "Review Checklist Template",
    description: "Reusable checklist for focused code review.",
    tags: ["template", "review", "checklist", "markdown"]
  },
  {
    source: "docs/templates/deploy/DEPLOY_CHECKLIST.md",
    artifactPath: "templates/deploy/DEPLOY_CHECKLIST.md",
    title: "Deploy Checklist Template",
    description: "Reusable checklist for service deployment validation.",
    tags: ["template", "deploy", "checklist", "ops", "markdown"]
  },
  {
    source: "docs/templates/release/RELEASE_CHECKLIST.md",
    artifactPath: "templates/release/RELEASE_CHECKLIST.md",
    title: "Release Checklist Template",
    description: "Reusable checklist for package releases and deployment readiness.",
    tags: ["template", "release", "checklist", "markdown"]
  },
  {
    source: "docs/templates/task/TASK_TEMPLATE.md",
    artifactPath: "templates/task/TASK_TEMPLATE.md",
    title: "Task Template",
    description: "Reusable task specification template for agent-executable work.",
    tags: ["template", "task", "planning", "markdown"]
  },
  {
    source: "docs/templates/handoff/HANDOFF_TEMPLATE.md",
    artifactPath: "templates/handoff/HANDOFF_TEMPLATE.md",
    title: "Handoff Template",
    description: "Reusable handoff template for transferring work between agents or developers.",
    tags: ["template", "handoff", "collaboration", "markdown"]
  },
  {
    source: "docs/templates/fault/FAULT_TEMPLATE.md",
    artifactPath: "templates/fault/FAULT_TEMPLATE.md",
    title: "Fault Template",
    description: "Reusable template for recording failed attempts and what not to repeat.",
    tags: ["template", "fault", "failed-attempt", "markdown"]
  }
];

export async function seedBundledTemplates(options: SeedTemplatesOptions = {}): Promise<SeedTemplatesResult> {
  const db = options.db ?? createPgKnex();
  const root = options.packageRoot ?? packageRoot;
  const clientId = options.clientId ?? "pm3m-seed-templates";
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  try {
    await assertTemplateFilesExist(root);
    await assertArtifactsTableExists(db);

    for (const seed of templateSeeds) {
      const content = await readFile(path.resolve(root, seed.source));
      const sha256 = createHash("sha256").update(content).digest("hex");
      const existing = await db("artifacts")
        .where({ project_id: null, path: seed.artifactPath })
        .first();
      const storagePath = path.posix.join("common", seed.artifactPath);

      if (existing && (await templateArtifactIsCurrent(existing, seed, sha256, storagePath))) {
        unchanged += 1;
        continue;
      }

      const now = new Date().toISOString();
      const id = existing?.id ? String(existing.id) : await nextArtifactId(db);
      const absolutePath = artifactAbsolutePath(storagePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);

      const row = {
        id,
        project_id: null,
        path: seed.artifactPath,
        title: seed.title,
        description: seed.description,
        content_type: "text/markdown; charset=utf-8",
        size_bytes: content.byteLength,
        sha256,
        storage_path: storagePath,
        status: "active",
        archived_at: null,
        archived_by: null,
        archive_reason: null,
        tags: JSON.stringify(seed.tags),
        created_by: existing?.created_by ?? clientId,
        updated_by: clientId,
        source_instance_id: clientId,
        version: Number(existing?.version ?? 0) + 1,
        created_at: existing?.created_at ?? now,
        updated_at: now
      };

      if (existing) {
        await db("artifacts").where({ id }).update(row);
        updated += 1;
      } else {
        await db("artifacts").insert(row);
        created += 1;
      }
    }

    const result = { created, updated, unchanged, templates: templateSeeds.length };
    options.log?.(
      `Seeded bundled templates: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`
    );
    return result;
  } finally {
    if (!options.db) {
      await db.destroy();
    }
  }
}

export function bundledTemplateSeeds(): readonly TemplateSeed[] {
  return templateSeeds;
}

async function assertTemplateFilesExist(root: string): Promise<void> {
  for (const seed of templateSeeds) {
    await readFile(path.resolve(root, seed.source));
  }
}

async function assertArtifactsTableExists(db: Knex): Promise<void> {
  const exists = await db.schema.hasTable("artifacts");
  if (!exists) {
    throw new Error("Cannot seed bundled templates because the artifacts table does not exist.");
  }
}

async function nextArtifactId(db: Knex): Promise<string> {
  const rows = await db("artifacts").select("id").where("id", "like", "A-COMMON-%");
  const next =
    rows.reduce((max, row) => {
      const match = String(row.id).match(/-(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return `A-COMMON-${String(next).padStart(3, "0")}`;
}

function artifactAbsolutePath(storagePath: string): string {
  const root = path.resolve(process.env.ARTIFACT_DIR ?? "artifacts");
  const absolutePath = path.resolve(root, storagePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
    throw new Error(`Artifact storage path escaped artifact root: ${storagePath}`);
  }
  return absolutePath;
}

async function templateArtifactIsCurrent(
  existing: Record<string, unknown>,
  seed: TemplateSeed,
  sha256: string,
  storagePath: string
): Promise<boolean> {
  return (
    String(existing.sha256) === sha256 &&
    String(existing.status ?? "active") === "active" &&
    String(existing.title) === seed.title &&
    String(existing.description ?? "") === seed.description &&
    String(existing.storage_path) === storagePath &&
    JSON.stringify(parseTags(existing.tags)) === JSON.stringify(seed.tags) &&
    (await artifactFileSha256(storagePath)) === sha256
  );
}

async function artifactFileSha256(storagePath: string): Promise<string | null> {
  try {
    const content = await readFile(artifactAbsolutePath(storagePath));
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (path.basename(current) === "node_modules") {
      break;
    }
    try {
      const entries = readdirSync(current);
      if (entries.includes("package.json")) {
        return current;
      }
    } catch {
      // Keep walking.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`Package root not found from ${startDir}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await seedBundledTemplates({ log: console.log });
}
