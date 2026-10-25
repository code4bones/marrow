import * as z from "zod/v4";
import { gitHostProblem } from "./git-host-safety.js";
import type { GatewayToolSpec } from "./tool-definitions.js";

const project = z.object({ project: z.string().min(1) });
const host = z.string().trim().toLowerCase().refine((value) => !gitHostProblem(value), "Invalid GitLab host.");
const memberHost = project.extend({ userId: z.string().min(1), host });

export const projectGitlabToolSpecs: GatewayToolSpec[] = [
  { name: "task.export_gitlab", description: "Export an assigned Marrow task to one GitLab issue, or retry a blocked/failed export. Uses the caller's own GitLab credential. Select repositoryId when the assignee leads several repositories. Existing links and uncertain POST outcomes are never re-created.", schema: z.object({ id: z.string().min(1), repositoryId: z.string().uuid().optional() }), access: "write" },
  { name: "task.gitlab_status", description: "Read a task's GitLab issue URL and durable export status or blocking reason.", schema: z.object({ id: z.string().min(1) }) },
  { name: "project.repositories", description: "List GitLab repositories attached to a Marrow project.", schema: project },
  { name: "project.repository_set_lead", description: "Set one active Marrow project member as this repository's lead developer, or pass userId:null to clear. Used as recipient for new issues without assignees. Owner/admin only; does not grant GitLab or Marrow permissions.", schema: project.extend({ id: z.string().uuid(), userId: z.string().min(1).nullable() }), access: "write" },
  { name: "project.repository_webhook_connect", description: "Register or repair this repository's GitLab issue webhook, routing new issues to its Marrow project. Uses a gateway-generated callback URL/secret and the caller's GitLab credential. Owner/admin only; existing webhook at the same URL is updated, not duplicated.", schema: project.extend({ id: z.string().uuid() }), access: "write" },
  { name: "project.repository_webhook_disconnect", description: "Disable issue import locally and remove the corresponding GitLab webhook where possible. Owner/admin only. Existing imported tasks remain.", schema: project.extend({ id: z.string().uuid() }), access: "write" },
  { name: "project.repository_webhook_retry", description: "Retry failed durable GitLab issue deliveries for one repository. Idempotent issue-to-task links prevent duplicate tasks. Owner/admin only.", schema: project.extend({ id: z.string().uuid() }), access: "write" },
  { name: "project.repository_add", description: "Attach a GitLab repository URL to a Marrow project. Verifies the repository with the caller's stored GitLab credential. Owner/admin only; duplicate additions are idempotent.", schema: project.extend({ url: z.string().trim().min(1).max(2048) }), access: "write" },
  { name: "project.repository_remove", description: "Detach a repository from a Marrow project; does not delete the GitLab repository or member mappings. Owner/admin only.", schema: project.extend({ id: z.string().uuid() }), access: "write" },
  { name: "project.gitlab_mappings", description: "List project-scoped Marrow member to GitLab user mappings. Owner/admin only.", schema: project },
  { name: "project.gitlab_users_search", description: "Search active users on a GitLab host attached to this project using the caller's stored credential. Returns at most 20 results. Owner/admin only.", schema: project.extend({ host, query: z.string().trim().min(2).max(100) }) },
  { name: "project.member_gitlab_set", description: "Map an active Marrow project member to a verified numeric GitLab user ID on one attached host. One recipient per external user in each project. Owner/admin only.", schema: memberHost.extend({ gitlabUserId: z.string().regex(/^[1-9][0-9]*$/).max(20) }), access: "write" },
  { name: "project.member_gitlab_remove", description: "Remove one project member's GitLab mapping for a host. Owner/admin only.", schema: memberHost, access: "write" }
];
