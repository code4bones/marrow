import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../../shared/errors.js";
import { DOWNLOAD_URL_TTL_SECONDS, downloadBaseUrl, downloadHash, exportRecordFile, type DownloadFile } from "../../record-downloads.js";
import { isCommonEventVisibleTo } from "../../private-events.js";
import type { Constructor } from "../base.js";
import type { Tier1Instance } from "../core/links-core.mixin.js";
import { artifactAbsolutePath, ensureArtifactBytesExist } from "../formatters/artifacts.js";
import { normalizeContext, stringArray } from "../formatters/common.js";
import type { GatewayRequestContext, NormalizedGatewayRequestContext, Row } from "../types.js";

export function DownloadsMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
    protected async downloadableRecord(id: string, context: NormalizedGatewayRequestContext): Promise<Row> {
      const lookup = await this.recordLookup(id);
      const record = lookup.record as Row;
      let projectId = lookup.projectId;
      if (lookup.kind === "MEMORY" && ["request", "reply"].includes(String(record.type)) && context.sessionRole === "member" && context.sessionUserId) {
        const rootId = record.type === "request" ? id : stringArray(record.tags).find((tag) => tag.startsWith("thread:"))?.slice(7);
        const askedBy = rootId ? await this.db("links").where({ from_id: rootId, relation: "asked_by" }).first() : null;
        if (askedBy && await this.isMemberOfProject(String(askedBy.to_id), context.sessionUserId)) projectId = null;
      }
      if (projectId) await this.assertProjectMember(String(projectId), context);
      if (lookup.kind === "EVENT" && !lookup.projectId && context.sessionUserId && !isCommonEventVisibleTo(
        { userId: context.sessionUserId, role: context.sessionRole ?? "member" },
        { type: String(record.type), credentialId: record.credentialId ? String(record.credentialId) : null }
      )) throw new AppError("NOT_FOUND", "Record does not exist.");
      if (lookup.kind === "LINK") {
        await this.assertRecordAccessible(String(record.fromId), context);
        await this.assertRecordAccessible(String(record.toId), context);
      }
      return lookup;
    }

    protected async downloadableFile(lookup: Row, format: string): Promise<DownloadFile> {
      if (lookup.kind !== "ARTIFACT") return exportRecordFile(lookup, format);
      const row = await this.db("artifacts").where({ id: String(lookup.id) }).first();
      if (!row) throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist.");
      const absolutePath = artifactAbsolutePath(String(row.storage_path));
      ensureArtifactBytesExist(row, absolutePath);
      const artifact = lookup.record as Row;
      if ((await stat(absolutePath)).size !== Number(artifact.sizeBytes)) throw new AppError("ARTIFACT_CONFLICT", "Artifact size does not match metadata.");
      return { filename: path.posix.basename(String(artifact.path)), contentType: String(artifact.contentType), sizeBytes: Number(artifact.sizeBytes), sha256: String(artifact.sha256), absolutePath, artifact };
    }

    protected async issueDownloadUrl(lookup: Row, input: Row, context: NormalizedGatewayRequestContext) {
      const baseUrl = downloadBaseUrl();
      const format = input.format === "json" ? "json" : "markdown";
      const file = await this.downloadableFile(lookup, format);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
      await this.db("download_grants").insert({ token_hash: downloadHash(token), record_id: String(lookup.id), format, user_id: context.sessionUserId, client_id: context.clientId, sha256: file.sha256, expires_at: expiresAt });
      return { id: String(lookup.id), kind: String(lookup.kind), filename: file.filename, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256,
        url: `${baseUrl}/artifacts/download/${token}/${encodeURIComponent(file.filename)}`, expiresAt, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
    }

    protected async createDownloadUrls(input: Row, context: NormalizedGatewayRequestContext) {
      const lookup = await this.downloadableRecord(String(input.id), context);
      const download = await this.issueDownloadUrl(lookup, input, context);
      await this.db("download_grants").where("expires_at", "<=", new Date().toISOString()).del();
      const attachments = [];
      const unavailableAttachments = [];
      if (input.includeAttachments !== false && lookup.kind !== "ARTIFACT") {
        const links = await this.db("links").where((q) => q.where("from_id", String(lookup.id)).orWhere("to_id", String(lookup.id)));
        const ids = [...new Set(links.map((link) => String(link.from_id === lookup.id ? link.to_id : link.from_id)))];
        const artifactRows = ids.length ? await this.db("artifacts").whereIn("id", ids).select("id") : [];
        for (const row of artifactRows) {
          let attachment;
          try { attachment = await this.downloadableRecord(String(row.id), context); }
          catch (error) { if (error instanceof AppError && ["PROJECT_NOT_FOUND", "NOT_FOUND"].includes(error.code)) continue; throw error; }
          try { attachments.push(await this.issueDownloadUrl(attachment, input, context)); }
          catch (error) {
            if (error instanceof AppError && ["ARTIFACT_BYTES_MISSING", "ARTIFACT_CONFLICT"].includes(error.code)) {
              unavailableAttachments.push({ id: String(row.id), code: error.code });
            } else throw error;
          }
        }
      }
      return { download, attachments, unavailableAttachments, instructions: "1. GET download.url (or an attachments[].url) with your HTTP/file tool, without Authorization or cookies. 2. Save using filename, verify sizeBytes/sha256, then open the file. 3. URLs expire after 300 seconds; request a fresh URL if expired. HEAD/Range and repeated GET work until expiry. Downloading a skill does not activate/apply its instructions." };
    }

    // Capability authorization is entirely the unguessable token. Reload its
    // issuing principal and record so membership/account revocation takes effect.
    async resolveDownloadUrl(token: string): Promise<DownloadFile> {
      const denied = () => new AppError("NOT_FOUND", "Download link is invalid or expired.");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw denied();
      const grant = await this.db("download_grants").where({ token_hash: downloadHash(token) }).first();
      if (!grant || new Date(grant.expires_at).getTime() <= Date.now()) throw denied();
      const context: GatewayRequestContext = { clientId: String(grant.client_id) };
      if (grant.user_id) {
        const user = await this.db("users").where({ id: grant.user_id, status: "active" }).first();
        if (!user) throw denied();
        context.sessionUserId = String(user.id); context.sessionRole = String(user.role);
      }
      try {
        const lookup = await this.downloadableRecord(String(grant.record_id), normalizeContext(context));
        const file = await this.downloadableFile(lookup, String(grant.format));
        if (file.sha256 !== grant.sha256) throw denied();
        return file;
      } catch { throw denied(); }
    }
  };
}
