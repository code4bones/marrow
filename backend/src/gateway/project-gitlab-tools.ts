import * as z from "zod/v4";
import { gitHostProblem } from "./git-host-safety.js";
import type { GatewayToolSpec } from "./tool-definitions.js";

const project = z.object({ project: z.string().min(1) });
const host = z.string().trim().toLowerCase().refine((value) => !gitHostProblem(value), "Invalid GitLab host.");
const memberHost = project.extend({ userId: z.string().min(1), host });

export const projectGitlabToolSpecs: GatewayToolSpec[] = [
  { name: "project.repositories", description: "List GitLab repositories attached to a Marrow project.", schema: project },
  { name: "project.repository_add", description: "Attach a GitLab repository URL to a Marrow project. Verifies the repository with the caller's stored GitLab credential. Owner/admin only; duplicate additions are idempotent.", schema: project.extend({ url: z.string().trim().min(1).max(2048) }), access: "write" },
  { name: "project.repository_remove", description: "Detach a repository from a Marrow project; does not delete the GitLab repository or member mappings. Owner/admin only.", schema: project.extend({ id: z.string().uuid() }), access: "write" },
  { name: "project.gitlab_mappings", description: "List project-scoped Marrow member to GitLab user mappings. Owner/admin only.", schema: project },
  { name: "project.gitlab_users_search", description: "Search active users on a GitLab host attached to this project using the caller's stored credential. Returns at most 20 results. Owner/admin only.", schema: project.extend({ host, query: z.string().trim().min(2).max(100) }) },
  { name: "project.member_gitlab_set", description: "Map an active Marrow project member to a verified numeric GitLab user ID on one attached host. One recipient per external user in each project. Owner/admin only.", schema: memberHost.extend({ gitlabUserId: z.string().regex(/^[1-9][0-9]*$/).max(20) }), access: "write" },
  { name: "project.member_gitlab_remove", description: "Remove one project member's GitLab mapping for a host. Owner/admin only.", schema: memberHost, access: "write" }
];
