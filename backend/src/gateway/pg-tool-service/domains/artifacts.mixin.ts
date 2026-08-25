import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { combinedRankSql, jsonStringArray, prefixRankSql, prefixWhereSql, stringArray, stringOrNull, toPrefixTsQueryText } from "../formatters/common.js";
import {
  artifactAbsolutePath,
  artifactOut,
  artifactSearchOut,
  artifactStoragePath,
  compactArtifactRecord,
  compactArtifactSearchRecord,
  decodeBase64,
  inferContentType,
  inferTextContentType,
  isMarkdownArtifact,
  isTextArtifact,
  limitText,
  markdownOutline,
  normalizeArtifactPath,
  readArtifactBytes,
  readArtifactPrefixForRow,
  redactSensitiveText
} from "../formatters/artifacts.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

export function ArtifactsMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  protected async putArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    return this.storeArtifact(input, context, decodeBase64(String(input.contentBase64)), {
      contentType: typeof input.contentType === "string" ? input.contentType : undefined,
      conflictTool: "artifact.put"
    });
  }

  protected async putTextArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const text = String(input.text ?? "");
    const artifactPath = normalizeArtifactPath(String(input.path));
    const contentType = typeof input.contentType === "string" ? input.contentType : inferTextContentType(artifactPath);
    if (!isTextArtifact(contentType, artifactPath)) {
      throw new AppError("VALIDATION_ERROR", "artifact.put_text requires a text-compatible contentType.", {
        path: artifactPath,
        contentType
      });
    }
    return this.storeArtifact(input, context, Buffer.from(text, "utf8"), {
      contentType,
      conflictTool: "artifact.put_text"
    });
  }

  protected async storeArtifact(
    input: Row,
    context: NormalizedGatewayRequestContext,
    content: Buffer,
    options: { contentType?: string; conflictTool: "artifact.put" | "artifact.put_text" }
  ) {
    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    const artifactPath = normalizeArtifactPath(String(input.path));
    const maxBytes = Number(process.env.ARTIFACT_MAX_BYTES ?? 10 * 1024 * 1024);
    if (content.byteLength > maxBytes) {
      throw new AppError("VALIDATION_ERROR", `Artifact exceeds ARTIFACT_MAX_BYTES (${maxBytes}).`, {
        sizeBytes: content.byteLength,
        maxBytes
      });
    }

    const existing = await this.db("artifacts")
      .where({ project_id: project?.id ?? null, path: artifactPath })
      .first();
    if (existing && input.overwrite !== true) {
      throw new AppError("ARTIFACT_CONFLICT", "Artifact already exists. Choose overwrite, a versioned path, or archive the existing artifact first.", {
        existing: artifactOut(existing),
        requested: {
          scope: project ? "project" : "common",
          projectId: project?.id ?? null,
          path: artifactPath,
          title: typeof input.title === "string" ? input.title : path.posix.basename(artifactPath),
          contentType: typeof input.contentType === "string" ? input.contentType : inferContentType(artifactPath),
          sizeBytes: content.byteLength,
          sha256: createHash("sha256").update(content).digest("hex")
        },
        suggestedActions: [
          {
            action: "keep_existing",
            description: "Do not upload. Use artifact.get or the existing downloadPath."
          },
          {
            action: "overwrite",
            description: `Call ${options.conflictTool} again with overwrite=true only after the user confirms replacement.`
          },
          {
            action: "versioned_path",
            description: `Call ${options.conflictTool} with a new path such as templates/name-v2.md or templates/name-YYYY-MM-DD.md.`
          },
          {
            action: "archive_then_put",
            description: `Call artifact.archive for the existing artifact, then ${options.conflictTool} with the original path.`
          }
        ]
      });
    }

    const now = nowIso();
    const id = existing?.id ? String(existing.id) : String(input.id ?? (await this.nextId("artifacts", `A-${project ? projectKeyFromId(project.id) : "COMMON"}`)));
    const title = typeof input.title === "string" ? input.title : path.posix.basename(artifactPath);
    const contentType = options.contentType ?? inferContentType(artifactPath);
    const storagePath = artifactStoragePath(project?.slug ?? null, artifactPath);
    const absolutePath = artifactAbsolutePath(storagePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);

    const row = {
      id,
      project_id: project?.id ?? null,
      path: artifactPath,
      title,
      description: stringOrNull(input.description),
      content_type: contentType,
      size_bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      storage_path: storagePath,
      status: existing?.status ?? "current",
      archived_at: existing?.archived_at ?? null,
      archived_by: existing?.archived_by ?? null,
      archive_reason: existing?.archive_reason ?? null,
      tags: jsonStringArray(input.tags),
      created_by: existing?.created_by ?? context.clientId,
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      version: Number(existing?.version ?? 0) + 1,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };

    if (existing) {
      await this.db("artifacts").where({ id }).update(row);
    } else {
      await this.db("artifacts").insert(row);
    }

    await this.recordEventForProject(
      project?.id ?? null,
      {
        type: existing ? "artifact.updated" : "artifact.created",
        title: existing ? `Artifact updated: ${artifactPath}` : `Artifact created: ${artifactPath}`,
        body: `Stored ${content.byteLength} bytes as ${contentType}.`,
        related_id: id
      },
      context
    );

    return artifactOut(row);
  }

  protected async searchArtifacts(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact search requires a project or includeCommon=true.");
    }

    let query = this.db("artifacts").select("*");
    const queryText = typeof input.query === "string" ? input.query : null;
    let hasFilter = false;
    if (queryText && input.prefix === true) {
      const prefixQuery = toPrefixTsQueryText(queryText);
      if (prefixQuery) {
        hasFilter = true;
        query = query
          .select(this.db.raw(`${prefixRankSql("artifacts")} as rank`, [prefixQuery, prefixQuery, prefixQuery]))
          .where((builder) => builder.whereRaw(prefixWhereSql(), [prefixQuery, prefixQuery, prefixQuery]).orWhereRaw("id ilike ?", [`%${queryText}%`]));
      }
    } else if (queryText) {
      hasFilter = true;
      query = query
        .select(this.db.raw(`${combinedRankSql("artifacts")} as rank`, [queryText, queryText, queryText]))
        .whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }

    query = query.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });

    if (Array.isArray(input.tags) && input.tags.length > 0) {
      query = query.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      query = query.andWhere("status", "current");
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy(hasFilter ? "rank" : "created_at", "desc")
      .limit(Number(input.limit ?? 10));
    const artifacts = rows.map(artifactSearchOut);
    return input.compact === true ? artifacts.map(compactArtifactSearchRecord) : artifacts;
  }

  protected async artifactSearchPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact search requires a project or includeCommon=true.");
    }

    const queryText = typeof input.query === "string" ? input.query : null;
    const base = this.db("artifacts");
    if (queryText) {
      base.whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      base.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      base.andWhere("status", "current");
    }

    return this.pageRows(
      base,
      input,
      (query) => {
        query.select("*");
        if (queryText) {
          query.select(this.db.raw(`${combinedRankSql("artifacts")} as rank`, [queryText, queryText, queryText]));
        }
        query.orderByRaw("case when project_id is null then 1 else 0 end asc");
        return query.orderBy(queryText ? "rank" : "created_at", "desc");
      },
      artifactSearchOut
    );
  }

  protected async listArtifacts(input: Row, context?: NormalizedGatewayRequestContext) {
    const commonOnly = input.common === true || input.project === null;
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact list requires a project or includeCommon=true.");
    }

    let query = this.db("artifacts").select("*");
    query = query.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });

    if (typeof input.pathPrefix === "string") {
      const prefix = normalizeArtifactPath(input.pathPrefix);
      query = query.andWhere("path", "like", `${prefix}%`);
    }
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      query = query.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      query = query.andWhere("status", "current");
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy("path", "asc")
      .limit(Number(input.limit ?? 20));
    const artifacts = rows.map(artifactOut);
    return input.compact === true ? artifacts.map(compactArtifactRecord) : artifacts;
  }

  protected async artifactsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const commonOnly = input.common === true || input.project === null;
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact list requires a project or includeCommon=true.");
    }

    const base = this.db("artifacts");
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (typeof input.pathPrefix === "string") {
      const prefix = normalizeArtifactPath(input.pathPrefix);
      base.andWhere("path", "like", `${prefix}%`);
    }
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      base.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      base.andWhere("status", "current");
    }

    // Owner's call (T-MEMORY realtime/sort audit): every other domain page
    // (tasks/decisions/memory/events) already defaults to newest-activity
    // first. This one alone sorted alphabetically by path, which reads as
    // stale/frozen next to the others. listArtifacts (the MCP path-browsing
    // tool, above) intentionally keeps path order -- that one's for
    // navigating by path prefix, not a recent-activity feed.
    return this.pageRows(
      base,
      input,
      (query) => query.select("*").orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("updated_at", "desc"),
      artifactOut
    );
  }

  protected async getArtifact(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id ? await this.artifactRowById(String(input.id), context) : await this.artifactRowByPath(input, context);
    const output = artifactOut(row);
    if (input.includeContent === true) {
      // Same rule peekArtifact/readTextArtifact already enforce for
      // binary content -- extended here so an agent can't get a .xlsx (or
      // any other binary) back as inline base64 just by asking getArtifact
      // for includeContent, the one path that previously still allowed it
      // for anything under maxBytes regardless of content type.
      if (!isTextArtifact(String(row.content_type), String(row.path))) {
        throw new AppError("VALIDATION_ERROR", "Artifact is binary. Use downloadPath instead of includeContent.", {
          contentType: row.content_type,
          downloadPath: output.downloadPath
        });
      }
      const maxBytes = Number(input.maxBytes ?? 1024 * 1024);
      const sizeBytes = Number(row.size_bytes ?? 0);
      if (sizeBytes > maxBytes) {
        throw new AppError("VALIDATION_ERROR", `Artifact is too large for inline content. Use downloadPath instead.`, {
          sizeBytes,
          maxBytes,
          downloadPath: output.downloadPath
        });
      }
      const content = await readArtifactBytes(row);
      return {
        ...output,
        contentBase64: content.toString("base64")
      };
    }
    return output;
  }

  protected async peekArtifact(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id ? await this.artifactRowById(String(input.id), context) : await this.artifactRowByPath(input, context);
    const output = artifactOut(row);
    const contentType = String(row.content_type);
    const artifactPath = String(row.path);
    const isText = isTextArtifact(contentType, artifactPath);
    const isMarkdown = isMarkdownArtifact(contentType, artifactPath);
    const sizeBytes = Number(row.size_bytes ?? 0);
    const maxBytes = Math.min(Number(input.maxBytes ?? 16 * 1024), sizeBytes);
    const excerptChars = Number(input.excerptChars ?? 1000);
    const outlineLimit = Number(input.outlineLimit ?? 20);

    if (!isText || maxBytes <= 0) {
      return {
        ...output,
        preview: {
          isText,
          isMarkdown,
          truncated: false,
          excerpt: null,
          outline: [],
          note: "Binary or non-text artifact. Use downloadPath when bytes are needed."
        }
      };
    }

    const buffer = await readArtifactPrefixForRow(row, maxBytes);
    const text = buffer.toString("utf8");
    const truncated = sizeBytes > buffer.byteLength || text.length > excerptChars;
    const excerpt = text.slice(0, excerptChars);
    return {
      ...output,
      preview: {
        isText,
        isMarkdown,
        truncated,
        readBytes: buffer.byteLength,
        maxBytes,
        excerpt,
        outline: isMarkdown ? markdownOutline(text, outlineLimit) : []
      }
    };
  }

  protected async readTextArtifact(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id ? await this.artifactRowById(String(input.id), context) : await this.artifactRowByPath(input, context);
    const output = artifactOut(row);
    const contentType = String(row.content_type);
    const artifactPath = String(row.path);
    const isText = isTextArtifact(contentType, artifactPath);
    const isMarkdown = isMarkdownArtifact(contentType, artifactPath);
    if (!isText) {
      throw new AppError("VALIDATION_ERROR", "Artifact is not a text artifact. Use downloadPath for binary bytes.", {
        contentType,
        path: artifactPath,
        downloadPath: output.downloadPath
      });
    }

    const sizeBytes = Number(row.size_bytes ?? 0);
    const maxBytes = Math.min(Number(input.maxBytes ?? 128 * 1024), sizeBytes);
    const maxChars = Number(input.maxChars ?? 20_000);
    const maxLines = Number(input.maxLines ?? 500);
    const outlineLimit = Number(input.outlineLimit ?? 40);
    const buffer =
      maxBytes > 0 ? await readArtifactPrefixForRow(row, maxBytes) : Buffer.alloc(0);
    const decoded = buffer.toString("utf8");
    const limited = limitText(decoded, maxChars, maxLines);
    const redaction = input.redactSecrets === false ? { text: limited.text, redactions: 0 } : redactSensitiveText(limited.text);
    const truncatedByBytes = sizeBytes > buffer.byteLength;
    const truncated = truncatedByBytes || limited.truncatedByChars || limited.truncatedByLines;

    return {
      ...output,
      text: redaction.text,
      textInfo: {
        isText,
        isMarkdown,
        encoding: "utf8",
        readBytes: buffer.byteLength,
        maxBytes,
        maxChars,
        maxLines,
        truncated,
        truncatedByBytes,
        truncatedByChars: limited.truncatedByChars,
        truncatedByLines: limited.truncatedByLines,
        redacted: redaction.redactions > 0,
        redactions: redaction.redactions,
        base64Included: false
      },
      outline: isMarkdown ? markdownOutline(redaction.text, outlineLimit) : []
    };
  }

  protected async updateArtifactMetadata(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id), context) : await this.artifactRowByPath(input, context);
    const [row] = await this.db("artifacts")
      .where({ id: String(current.id) })
      .update({
        title: typeof input.title === "string" ? input.title : current.title,
        description:
          input.description === null
            ? null
            : typeof input.description === "string"
              ? input.description
              : current.description,
        tags: jsonStringArray(Array.isArray(input.tags) ? input.tags : current.tags),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "artifact.metadata_updated",
      title: `Artifact metadata updated: ${String(row.path)}`,
      related_id: row.id
    }, context);
    return artifactOut(row);
  }

  protected async archiveArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id), context) : await this.artifactRowByPath(input, context);
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        artifact: artifactOut(current),
        event: null
      };
    }

    const now = nowIso();
    const [row] = await this.db("artifacts")
      .where({ id: String(current.id) })
      .update({
        status: "archived",
        archived_at: now,
        archived_by: context.clientId,
        archive_reason: stringOrNull(input.reason),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "artifact.archived",
      title: `Artifact archived: ${String(row.path)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);

    return {
      action: "archived",
      artifact: artifactOut(row),
      event
    };
  }

  protected async deleteArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id), context) : await this.artifactRowByPath(input, context);
    const id = String(current.id);
    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("artifacts").where({ id }).del();
    });
    await rm(artifactAbsolutePath(String(current.storage_path)), { force: true });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "artifact.deleted",
      title: `Artifact deleted: ${String(current.path)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedArtifact: artifactOut(current),
      deletedLinks,
      event
    };
  }

  // T-MEMORY-057 (IDOR): artifact ids are sequential/predictable too;
  // artifactRowByPath is already safe (goes through resolveProject ->
  // getProject -> assertProjectMember), only the by-id path was not.
  protected async artifactRowById(id: string, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const row = await this.db("artifacts").where({ id }).first();
    if (!row) {
      throw new AppError("ARTIFACT_NOT_FOUND", `Artifact ${id} does not exist.`, { id });
    }
    if (row.project_id) {
      await this.assertProjectMember(String(row.project_id), context);
    }
    return row;
  }

  protected async artifactRowByPath(input: Row, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const common = input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    const artifactPath = normalizeArtifactPath(String(input.path));
    const row = await this.db("artifacts").where({ project_id: project?.id ?? null, path: artifactPath }).first();
    if (!row) {
      throw new AppError("ARTIFACT_NOT_FOUND", `Artifact ${artifactPath} does not exist.`, {
        project: project?.id ?? null,
        path: artifactPath
      });
    }
    return row;
  }

  };
}
