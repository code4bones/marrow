import type { Knex } from "knex";
import { AppError } from "../../shared/errors.js";
import { fail, ok, type ToolResponse } from "../../shared/mcp/tool-response.js";
import { gatewayToolCanonicalName, gatewayToolSpecs } from "../tool-definitions.js";
import type { GitHttpFetch } from "../git-credentials.js";
import { BaseService } from "./base.js";
import { ProjectsCoreMixin } from "./core/projects-core.mixin.js";
import { LinksCoreMixin } from "./core/links-core.mixin.js";
import { MemoryMixin } from "./domains/memory.mixin.js";
import { ArtifactsMixin } from "./domains/artifacts.mixin.js";
import { DecisionsMixin } from "./domains/decisions.mixin.js";
import { SkillsMixin } from "./domains/skills.mixin.js";
import { EventsMixin } from "./domains/events.mixin.js";
import { ClientsMixin } from "./domains/clients.mixin.js";
import { GitCredentialsMixin } from "./domains/git-credentials.mixin.js";
import { CreditsMixin } from "./domains/credits.mixin.js";
import { GraphMixin } from "./domains/graph.mixin.js";
import { UserPrefsMixin } from "./domains/user-prefs.mixin.js";
import { GatewayOpsMixin } from "./domains/gateway-ops.mixin.js";
import { TasksMixin } from "./domains/tasks.mixin.js";
import { HandoffsMixin } from "./domains/handoffs.mixin.js";
import { RequestsMixin } from "./domains/requests.mixin.js";
import { I18nMixin } from "./domains/i18n.mixin.js";
import { GlobalSearchMixin } from "./aggregates/global-search.mixin.js";
import { PreflightContextMixin } from "./aggregates/preflight-context.mixin.js";
import { ProjectSummaryMixin } from "./aggregates/project-summary.mixin.js";
import { normalizeContext } from "./formatters/common.js";
import { manualEfficiencyHints } from "./formatters/gateway-ops.js";
import {
  artifactAbsolutePath,
  artifactGetEfficiencyHints,
  artifactOut,
  artifactPeekEfficiencyHints,
  artifactReadTextEfficiencyHints,
  artifactWriteEfficiencyHints,
  ensureArtifactBytesExist,
  type ArtifactDownload
} from "./formatters/artifacts.js";
import type { GatewayRequestContext, Row } from "./types.js";

const ComposedService = GlobalSearchMixin(
  ProjectSummaryMixin(
    PreflightContextMixin(
      RequestsMixin(
        HandoffsMixin(
          I18nMixin(
            TasksMixin(
              GatewayOpsMixin(
                UserPrefsMixin(
                  GraphMixin(
                    GitCredentialsMixin(
                      CreditsMixin(
                        ClientsMixin(
                          EventsMixin(
                            SkillsMixin(
                              DecisionsMixin(
                                ArtifactsMixin(
                                  MemoryMixin(
                                    LinksCoreMixin(
                                      ProjectsCoreMixin(BaseService)
                                    )
                                  )
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )
);

export class PgToolService extends ComposedService {
  constructor(db: Knex, gitHttpFetch: GitHttpFetch = fetch) {
    super(db, gitHttpFetch);
  }

  async call(
    toolName: string,
    input: unknown,
    context: GatewayRequestContext = {}
  ): Promise<ToolResponse<unknown>> {
    const canonicalToolName = gatewayToolCanonicalName(toolName);
    const spec = gatewayToolSpecs.find((tool) => tool.name === canonicalToolName);
    if (!spec) {
      return fail(new AppError("VALIDATION_ERROR", `Tool ${toolName} is not registered.`));
    }

    try {
      const requestContext = normalizeContext(context);
      // General agent self-identification (owner's ask, 2026-09-02): any
      // write call can carry a top-level `agent` string naming which agent
      // made it (e.g. "backend"/"front") -- read from the raw input, not
      // from `parsed`, so it works even for tools whose zod schema doesn't
      // declare it (schema.parse silently strips unknown keys either way).
      // recordEventForProject (base.ts) stamps it on every event this call
      // produces. No built-in identity exists for this -- purely a
      // self-reported convention, same as request/reply's fromAgent/toAgent.
      const rawAgent = input && typeof input === "object" ? (input as Row).agent : undefined;
      if (typeof rawAgent === "string" && rawAgent.trim()) {
        requestContext.agentName = rawAgent.trim();
      }
      const parsed = spec.schema.parse(input ?? {}) as Row;
      await this.touchClient(requestContext, { cleanupAnonymous: canonicalToolName !== "gateway.client_prune" });
      switch (canonicalToolName) {
        case "gateway.about":
          return ok("Project Memory overview loaded.", { about: this.gatewayAbout() });
        case "gateway.version":
          return ok("Gateway version loaded.", { version: await this.gatewayVersion() });
        case "gateway.diagnostics":
          return ok("Gateway diagnostics loaded.", { diagnostics: await this.gatewayDiagnostics() });
        case "gateway.connector_info":
          return ok("Gateway connector info loaded.", { connectorInfo: await this.gatewayConnectorInfo() });
        case "gateway.backup_manifest":
          return ok("Gateway backup manifest loaded.", { manifest: await this.gatewayBackupManifest() });
        case "gateway.manuals": {
          const manuals = await this.gatewayManuals(parsed);
          return ok("Project Memory manuals loaded.", {
            manuals,
            efficiencyHints: manualEfficiencyHints(parsed, manuals)
          });
        }
        case "gateway.status":
          return ok("Gateway status loaded.", { status: await this.gatewayStatus() });
        case "gateway.clients":
          return ok("Gateway clients listed.", { clients: await this.listClients(parsed) });
        case "gateway.client_get":
          return ok("Gateway client loaded.", { client: await this.getClient(parsed) });
        case "gateway.client_forget":
          return ok("Gateway client forgotten.", await this.forgetClient(parsed));
        case "gateway.client_prune":
          return ok("Gateway clients pruned.", await this.pruneClients(parsed));
        case "gateway.actor_labels":
          return ok("Actor labels resolved.", { labels: await this.actorLabels(parsed) });
        case "project.create":
          return ok("Project created.", { project: await this.createProject(parsed, requestContext) });
        case "project.list":
          return ok("Projects listed.", { projects: await this.listProjects(parsed, requestContext) });
        case "project.get":
          return ok("Project loaded.", { project: await this.getProject(parsed, requestContext) });
        case "project.members":
          return ok("Project members listed.", await this.listProjectMembers(parsed, requestContext));
        case "project.update":
          return ok("Project updated.", { project: await this.updateProject(parsed, requestContext) });
        case "project.invite_link_get":
          return ok("Project invite link loaded.", await this.getOrCreateProjectInviteLink(parsed, requestContext));
        case "project.invite_link_regenerate":
          return ok("Project invite link regenerated.", await this.regenerateProjectInviteLink(parsed, requestContext));
        case "project.invite_claim":
          return ok("Project joined.", await this.claimProjectInviteLink(parsed, requestContext));
        case "project.my_role":
          return ok("Project role resolved.", await this.myProjectRole(parsed, requestContext));
        case "project.pending_members":
          return ok("Pending project members listed.", await this.pendingProjectMembers(parsed, requestContext));
        case "project.approve_member":
          return ok("Project member approved.", await this.approveProjectMember(parsed, requestContext));
        case "project.reject_member":
          return ok("Project member rejected.", await this.rejectProjectMember(parsed, requestContext));
        case "project.update_member_role":
          return ok("Project member role updated.", await this.updateProjectMemberRole(parsed, requestContext));
        case "project.delete":
          return ok("Project deleted.", await this.deleteProject(parsed, requestContext));
        case "project.resolve":
          return ok("Project candidates resolved.", await this.resolveProjectCandidates(parsed, requestContext));
        case "project.summary":
          return ok("Project summary loaded.", await this.projectSummary(parsed, requestContext));
        case "project.search":
          return ok("Project searched.", await this.globalSearch(parsed, requestContext));
        case "project.set_current":
          return ok("Current project set.", { currentProject: await this.setCurrentProject(parsed, requestContext) });
        case "project.current":
          return ok("Current project loaded.", { project: await this.currentProject(requestContext) });
        case "memory.create":
          return ok("Memory item created.", { item: await this.createMemory(parsed, requestContext) });
        case "memory.upsert": {
          const result = await this.upsertMemory(parsed, requestContext);
          return ok(`Memory item ${result.action}.`, result);
        }
        case "failed_attempt.record":
          return ok("Failed attempt recorded.", await this.recordFailedAttempt(parsed, requestContext));
        case "memory.get":
          return ok("Memory item loaded.", { item: await this.getMemory(String(parsed.id), requestContext) });
        case "memory.search":
          return ok("Memory searched.", { results: await this.searchMemory(parsed, requestContext) });
        case "memory.update":
          return ok("Memory item updated.", { item: await this.updateMemory(parsed, requestContext) });
        case "memory.archive":
          return ok("Memory item archived.", await this.archiveMemory(parsed, requestContext));
        case "memory.delete":
          return ok("Memory item deleted.", await this.deleteMemory(parsed, requestContext));
        case "memory.hygiene_report":
          return ok("Memory hygiene report loaded.", await this.memoryHygieneReport(parsed, requestContext));
        case "artifact.put":
          return ok("Artifact stored.", {
            artifact: await this.putArtifact(parsed, requestContext),
            efficiencyHints: artifactWriteEfficiencyHints("artifact.put")
          });
        case "artifact.put_text":
          return ok("Text artifact stored.", {
            artifact: await this.putTextArtifact(parsed, requestContext),
            efficiencyHints: artifactWriteEfficiencyHints("artifact.put_text")
          });
        case "artifact.search":
          return ok("Artifacts searched.", { results: await this.searchArtifacts(parsed, requestContext) });
        case "artifact.list":
          return ok("Artifacts listed.", { artifacts: await this.listArtifacts(parsed, requestContext) });
        case "artifact.get": {
          const artifact = await this.getArtifact(parsed, requestContext);
          return ok("Artifact loaded.", {
            artifact,
            efficiencyHints: artifactGetEfficiencyHints(parsed, artifact)
          });
        }
        case "artifact.peek": {
          const artifact = await this.peekArtifact(parsed, requestContext);
          return ok("Artifact preview loaded.", {
            artifact,
            efficiencyHints: artifactPeekEfficiencyHints(artifact)
          });
        }
        case "artifact.read_text": {
          const artifact = await this.readTextArtifact(parsed, requestContext);
          return ok("Artifact text loaded.", {
            artifact,
            efficiencyHints: artifactReadTextEfficiencyHints(artifact)
          });
        }
        case "artifact.update_metadata":
          return ok("Artifact metadata updated.", { artifact: await this.updateArtifactMetadata(parsed, requestContext) });
        case "artifact.archive":
          return ok("Artifact archived.", await this.archiveArtifact(parsed, requestContext));
        case "artifact.delete":
          return ok("Artifact deleted.", await this.deleteArtifact(parsed, requestContext));
        case "skill.record":
          return ok("Skill recorded.", await this.recordSkill(parsed, requestContext));
        case "skill.list":
          return ok("Skills listed.", { skills: await this.listSkills(parsed, requestContext) });
        case "skill.get":
          return ok("Skill loaded.", { skill: await this.getSkill(String(parsed.id), requestContext) });
        case "skill.update":
          return ok("Skill updated.", { skill: await this.updateSkill(parsed, requestContext) });
        case "skill.archive":
          return ok("Skill archived.", await this.archiveSkill(parsed, requestContext));
        case "skill.delete":
          return ok("Skill deleted.", await this.deleteSkill(parsed, requestContext));
        case "skill.activate":
          return ok("Skill activated.", await this.activateSkill(parsed, requestContext));
        case "task.create":
          return ok("Task created.", { task: await this.createTask(parsed, requestContext) });
        case "task.list":
          return ok("Tasks listed.", { tasks: await this.listTasks(parsed, requestContext) });
        case "task.get":
          return ok("Task loaded.", { task: await this.getTask(String(parsed.id), requestContext) });
        case "task.delete":
          return ok("Task deleted.", await this.deleteTask(parsed, requestContext));
        case "task.claim":
          return ok("Task claimed.", await this.claimTask(parsed, requestContext));
        case "task.claim_heartbeat":
          return ok("Task claim heartbeat recorded.", { claim: await this.heartbeatTaskClaim(parsed, requestContext) });
        case "task.claim_complete":
          return ok("Task claim completed.", await this.completeTaskClaim(parsed, requestContext));
        case "task.release":
          return ok("Task claim released.", await this.releaseTaskClaim(parsed, requestContext));
        case "task.claims":
          return ok("Task claims loaded.", { claims: await this.listTaskClaims(parsed, requestContext) });
        case "task.complete":
          return ok("Task completed.", await this.completeTask(parsed, requestContext));
        case "task.add_note":
          return ok("Task note added.", await this.addTaskNote(parsed, requestContext));
        case "task.next":
          return ok("Next task loaded.", { task: await this.nextTask(parsed, requestContext) });
        case "task.update_status":
          return ok("Task status updated.", await this.updateTaskStatus(parsed, requestContext));
        case "task.update_milestone":
          return ok("Task milestone updated.", { task: await this.updateTaskMilestone(parsed, requestContext) });
        case "task.update_title":
          return ok("Task title updated.", { task: await this.updateTaskTitle(parsed, requestContext) });
        case "task.update_priority":
          return ok("Task priority updated.", { task: await this.updateTaskPriority(parsed, requestContext) });
        case "task.update_details":
          return ok("Task details updated.", { task: await this.updateTaskDetails(parsed, requestContext) });
        case "task.update_assignee":
          return ok("Task assignee updated.", { task: await this.updateTaskAssignee(parsed, requestContext) });
        case "decision.record":
          return ok("Decision recorded.", await this.recordDecision(parsed, requestContext));
        case "decision.update_status":
          return ok("Decision status updated.", await this.updateDecisionStatus(parsed, requestContext));
        case "decision.update_milestone":
          return ok("Decision milestone updated.", { decision: await this.updateDecisionMilestone(parsed, requestContext) });
        case "decision.update_assignee":
          return ok("Decision assignee updated.", { decision: await this.updateDecisionAssignee(parsed, requestContext) });
        case "decision.supersede":
          return ok("Decision superseded.", await this.supersedeDecision(parsed, requestContext));
        case "decision.archive":
          return ok("Decision archived.", await this.archiveDecision(parsed, requestContext));
        case "decision.delete":
          return ok("Decision deleted.", await this.deleteDecision(parsed, requestContext));
        case "decision.list":
          return ok("Decisions listed.", { decisions: await this.listDecisions(parsed, requestContext) });
        case "decision.get":
          return ok("Decision loaded.", { decision: await this.getDecision(String(parsed.id), requestContext) });
        case "event.record":
          return ok("Event recorded.", { event: await this.recordEvent(parsed, requestContext) });
        case "event.list":
          return ok("Events listed.", { events: await this.listEvents(parsed, requestContext) });
        case "event.delete":
          return ok("Event deleted.", await this.deleteEvent(parsed, requestContext));
        case "link.create":
          return ok("Link created.", { link: await this.createLink(parsed, requestContext) });
        case "link.list":
          return ok("Links listed.", { links: await this.listLinks(parsed) });
        case "link.delete":
          return ok("Link deleted.", await this.deleteLink(parsed, requestContext));
        case "preflight":
          return ok("Preflight context loaded.", await this.preflight(parsed, requestContext));
        case "preflight.by_query":
          return ok("Preflight query context loaded.", await this.preflightByQuery(parsed, requestContext));
        case "context.pack":
          return ok("Compact context pack loaded.", await this.contextPack(parsed, requestContext));
        case "context.changed_since":
          return ok("Changed context loaded.", await this.contextChangedSince(parsed, requestContext));
        case "handoff.create":
          return ok("Handoff created.", await this.createHandoff(parsed, requestContext));
        case "handoff.latest":
          return ok("Latest handoffs loaded.", { handoffs: await this.latestHandoffs(parsed, requestContext) });
        case "handoff.search":
          return ok("Handoffs searched.", { handoffs: await this.searchHandoffs(parsed, requestContext) });
        case "request.create":
          return ok("Request created.", await this.createRequest(parsed, requestContext));
        case "request.list":
          return ok("Requests listed.", { requests: await this.listRequests(parsed, requestContext) });
        case "request.get":
          return ok("Request loaded.", await this.getRequest(String(parsed.id)));
        case "reply.create":
          return ok("Reply created.", await this.createReply(parsed, requestContext));
        case "git.credential_create":
          return ok("Git credential stored.", await this.createGitCredential(parsed, requestContext));
        case "git.credential_list":
          return ok("Git credentials listed.", { credentials: await this.listGitCredentials(requestContext) });
        case "git.credential_delete":
          return ok("Git credential deleted.", await this.deleteGitCredential(parsed, requestContext));
        case "git.pipeline_status":
          return ok("Pipeline status loaded.", await this.gitPipelineStatus(parsed, requestContext));
        case "git.job_trace":
          return ok("Job trace loaded.", await this.gitJobTrace(parsed, requestContext));
        case "git.runners_status":
          return ok("Runners status loaded.", await this.gitRunnersStatus(parsed, requestContext));
        case "credit.balance":
          return ok("Credit balance loaded.", { balance: await this.creditBalance(parsed, requestContext) });
        case "credit.history":
          return ok("Credit history loaded.", { transactions: await this.creditHistory(parsed, requestContext) });
        case "credit.leaderboard":
          return ok("Credit leaderboard loaded.", { leaderboard: await this.creditLeaderboard(parsed) });
        case "credit.settings_get":
          return ok("Credit settings loaded.", { settings: await this.creditSettingsGet() });
        case "credit.settings_update":
          return ok("Credit settings updated.", { settings: await this.creditSettingsUpdate(parsed, requestContext) });
        case "project.pin":
          return ok("Project pin updated.", { project: await this.pinProject(parsed, requestContext) });
        case "user.preferences_get":
          return ok("User preferences loaded.", { preferences: await this.userPreferencesGet(requestContext) });
        case "user.preference_set":
          return ok("User preference updated.", await this.userPreferenceSet(parsed, requestContext));
        default:
          return fail(new AppError("VALIDATION_ERROR", `Tool ${toolName} is not implemented.`));
      }
    } catch (error) {
      return fail(error);
    }
  }

  async graphqlPage(pageName: string, input: unknown, context: GatewayRequestContext = {}): Promise<Row> {
    const requestContext = normalizeContext(context);
    await this.touchClient(requestContext, { cleanupAnonymous: true });
    const parsed = (input ?? {}) as Row;
    switch (pageName) {
      case "projects":
        return this.projectsPage(parsed, requestContext);
      case "gatewayClients":
        return this.gatewayClientsPage(parsed);
      case "memoryItems":
        return this.memoryItemsPage(parsed, requestContext);
      case "memorySearch":
        return this.memorySearchPage(parsed, requestContext);
      case "tasks":
        return this.tasksPage(parsed, requestContext);
      case "decisions":
        return this.decisionsPage(parsed, requestContext);
      case "artifacts":
        return this.artifactsPage(parsed, requestContext);
      case "artifactSearch":
        return this.artifactSearchPage(parsed, requestContext);
      case "skills":
        return this.skillsPage(parsed, requestContext);
      case "events":
        return this.eventsPage(parsed, requestContext);
      case "links":
        return this.linksPage(parsed, requestContext);
      default:
        throw new AppError("VALIDATION_ERROR", `GraphQL page ${pageName} is not registered.`);
    }
  }

  // T-MEMORY-057 (IDOR): recordLookup itself can't call assertProjectMember
  // (it lives on BaseService, below ProjectsCoreMixin in the composition
  // chain -- see service.ts's ComposedService), so the check happens here
  // instead, the one place every record(id) GraphQL lookup (the DetailDrawer's
  // sole data source, for every record kind) actually flows through. Record
  // ids are sequential/predictable, so without this a role=member could read
  // full details of any record in any project just by guessing an id.
  async graphqlRecord(id: string, context: GatewayRequestContext = {}): Promise<Row> {
    const requestContext = normalizeContext(context);
    await this.touchClient(requestContext, { cleanupAnonymous: true });
    const record = await this.recordLookup(String(id));
    if (record.projectId) {
      await this.assertProjectMember(String(record.projectId), requestContext);
    }
    return record;
  }

  async graphqlProjectGraph(input: unknown, context: GatewayRequestContext = {}): Promise<Row> {
    const requestContext = normalizeContext(context);
    await this.touchClient(requestContext, { cleanupAnonymous: true });
    return this.projectGraph((input ?? {}) as Row, requestContext);
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  // Unauthenticated invite-landing lookup (GET /project-invites/:code in
  // http-server.ts) -- deliberately bypasses call()'s scope/session
  // machinery entirely, same as artifactDownload below, since this must
  // work for a fully anonymous visitor who hasn't logged in yet.
  async projectInviteContext(code: string): Promise<{ projectTitle: string; projectSlug: string }> {
    return this.resolveProjectInviteContext(code);
  }

  // i18nBundle (from I18nMixin) is already public and self-contained, so
  // GET /i18n/:locale/:namespace in http-server.ts calls it directly --
  // same "unauthenticated, bypasses call()'s scope/session machinery
  // entirely" reasoning as projectInviteContext above.

  // T-MEMORY-057-style IDOR: this used to call artifactRowById(id) with no
  // context at all, so assertProjectMember's own guard (`if (!context)
  // return;`, projects-core.mixin.ts) short-circuited and never checked
  // project membership -- any authenticated caller (session, personal
  // token, static token) could download any project's artifact bytes by
  // id, the one check every other by-id artifact read (getArtifact et al.,
  // which do pass context through) already had. Found while designing the
  // agent-download side of the bulk artifact upload feature, since this is
  // exactly the endpoint that flow leans on.
  async artifactDownload(id: string, context: GatewayRequestContext = {}): Promise<ArtifactDownload> {
    const row = await this.artifactRowById(id, normalizeContext(context));
    const absolutePath = artifactAbsolutePath(String(row.storage_path));
    ensureArtifactBytesExist(row, absolutePath);
    return {
      artifact: artifactOut(row),
      absolutePath
    };
  }
}
