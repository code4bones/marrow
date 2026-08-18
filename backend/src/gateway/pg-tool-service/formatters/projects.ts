import path from "node:path";
import { dateStringOrNull, shortText, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function compactProject(project: Row) {
  return {
    id: String(project.id),
    slug: String(project.slug),
    title: String(project.title),
    status: String(project.status),
    description: shortText(stringOrNull(project.description), 240)
  };
}


export function projectOut(row: Row) {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: stringOrNull(row.description),
    status: String(row.status),
    rootPath: stringOrNull(row.root_path),
    ownerUserId: stringOrNull(row.owner_user_id),
    createdBy: stringOrNull(row.created_by),
    createdAt: dateStringOrNull(row.created_at),
    updatedAt: dateStringOrNull(row.updated_at)
  };
}

// Project sharing (invite links): the frontend is always served from the
// same origin as this gateway's own publicUrl, root path instead of the API
// prefix -- same reasoning/deployment shape as oauth.ts's frontendOrigin()
// helper (added for the OAuth SSO feature), reimplemented here as a small
// standalone equivalent since PgToolService has no OAuthConfig to read from.
// Falls back to a relative path when PROJECT_MEMORY_PUBLIC_URL isn't set
// (e.g. local/dev without the OAuth facade configured) -- still a usable,
// copy/pasteable link relative to wherever the gateway is being browsed.
export function projectInviteLinkUrl(code: string): string {
  const publicUrl = process.env.PROJECT_MEMORY_PUBLIC_URL;
  if (!publicUrl) {
    return `/invite/${code}`;
  }
  try {
    return new URL(`/invite/${code}`, new URL(publicUrl).origin).toString();
  } catch {
    return `/invite/${code}`;
  }
}

export function projectInviteLinkOut(row: Row) {
  const code = String(row.code);
  return {
    code,
    url: projectInviteLinkUrl(code)
  };
}


export function scoreProjectCandidate(row: Row, input: Row) {
  let score = 0;
  const reasons: string[] = [];
  const project = projectOut(row);
  const slug = project.slug.toLowerCase();
  const title = project.title.toLowerCase();
  const id = project.id.toLowerCase();
  const rootPath = normalizeComparablePath(project.rootPath);
  const inputRootPath = normalizeComparablePath(stringOrNull(input.rootPath));
  const remoteSlug = typeof input.remoteUrl === "string" ? slugFromRemoteUrl(input.remoteUrl) : null;
  const query = typeof input.query === "string" ? input.query.toLowerCase() : null;

  if (typeof input.id === "string" && input.id.toLowerCase() === id) {
    score += 120;
    reasons.push("id");
  }
  if (typeof input.slug === "string" && input.slug.toLowerCase() === slug) {
    score += 100;
    reasons.push("slug");
  }
  if (typeof input.title === "string" && input.title.toLowerCase() === title) {
    score += 85;
    reasons.push("title");
  }
  if (inputRootPath && rootPath && inputRootPath === rootPath) {
    score += 95;
    reasons.push("rootPath");
  } else if (inputRootPath && rootPath && inputRootPath.startsWith(`${rootPath}${path.sep}`)) {
    score += 80;
    reasons.push("rootPathParent");
  }
  if (remoteSlug && remoteSlug === slug) {
    score += 70;
    reasons.push("remoteUrlRepoName");
  }
  if (query) {
    if (query === id || query === slug || query === title) {
      score += 75;
      reasons.push("queryExact");
    } else if (slug.includes(query) || title.includes(query) || id.includes(query)) {
      score += 35;
      reasons.push("queryPartial");
    }
  }

  return {
    project,
    score,
    reasons
  };
}

function normalizeComparablePath(value: string | null): string | null {
  return value ? path.resolve(value) : null;
}


export function slugFromRemoteUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).at(-1);
  if (!lastSegment) {
    return null;
  }
  return lastSegment.replace(/\.git$/i, "").toLowerCase();
}

