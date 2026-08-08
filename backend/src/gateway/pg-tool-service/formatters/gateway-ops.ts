import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../../../shared/errors.js";
import { tokenEfficiencyBase } from "./common.js";
import type { Row } from "../types.js";

export function manualEfficiencyHints(input: Row, manuals: Row[]) {
  const includeContent = input.includeContent === true;
  const estimatedChars = JSON.stringify(manuals).length;
  const warnings = includeContent
    ? ["Manual content was included. Compact the chat after reading if you will continue implementation work."]
    : ["Manual content was not included. Request includeContent=true only for the specific manual you need."];
  return tokenEfficiencyBase({
    severity: includeContent || estimatedChars > 12_000 ? "warn" : "info",
    strategy: includeContent ? "manual-full-content" : "manual-metadata-first",
    fullBodiesIncluded: includeContent,
    estimatedChars,
    warnings,
    preferredNextTools: includeContent ? ["context.pack", "preflight.by_query"] : ["gateway.manuals"],
    compactAfterThis: includeContent || estimatedChars > 12_000
  });
}


export async function readBundledManual(relativePath: string): Promise<string> {
  const attemptedPaths: string[] = [];
  for (const candidate of manualPathCandidates(relativePath)) {
    attemptedPaths.push(candidate);
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next layout. Source runs from src/, package runs from dist/.
    }
  }
  throw new AppError("NOT_FOUND", `Bundled manual ${relativePath} could not be read.`, {
    path: relativePath,
    attemptedPaths
  });
}


export function manualPathCandidates(relativePath: string): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return Array.from(
    new Set([
      path.resolve(moduleDir, "../..", relativePath),
      path.resolve(moduleDir, "../../..", relativePath),
      path.resolve(process.cwd(), relativePath)
    ])
  );
}


export async function readPackageMetadata(): Promise<{ name: string; version: string }> {
  const packagePath = path.resolve(packageRoot(), "package.json");
  const parsed = JSON.parse(await readFile(packagePath, "utf8")) as Row;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "unknown",
    version: typeof parsed.version === "string" ? parsed.version : "unknown"
  };
}


export function migrationField(migration: unknown, key: "name" | "file"): string {
  if (typeof migration === "object" && migration !== null && key in migration) {
    const value = (migration as Record<string, unknown>)[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return String(migration);
}


export function packageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    process.cwd(),
    path.resolve(moduleDir, "../.."),
    path.resolve(moduleDir, "../../..")
  ]) {
    if (existsSync(path.resolve(candidate, "package.json"))) {
      return candidate;
    }
  }
  return process.cwd();
}

