import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-graphql-smoke-token-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token
});
const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;

const unique = Date.now();
const clientId = `gateway-graphql-smoke-${unique}`;
const projectSlug = `gateway-graphql-smoke-${unique}`;
let projectId: string | undefined;

try {
  const unauthorized = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ gatewayStatus }" })
  });
  assert(unauthorized.status === 401, `GraphQL endpoint did not reject missing auth. Status: ${unauthorized.status}`);
  console.log("ok - graphql auth required");

  const options = await fetch(graphqlUrl, { method: "OPTIONS" });
  assert(options.status === 204, `GraphQL OPTIONS did not return 204. Status: ${options.status}`);
  console.log("ok - graphql cors preflight");

  const status = await graphql<{ gatewayStatus: { storage: string } }>("{ gatewayStatus }");
  assert(status.gatewayStatus.storage === "postgresql", "GraphQL gatewayStatus did not expose PostgreSQL storage.");
  console.log("ok - graphql gatewayStatus");

  const created = await graphql<{
    createProject: { id: string; slug: string };
    createTask: { id: string; title: string; status: string };
    putTextArtifact: { id: string; path: string; title: string };
  }>(
    `mutation CreateSmoke($project: CreateProjectInput!, $task: CreateTaskInput!, $artifact: PutTextArtifactInput!) {
      createProject(input: $project) { id slug }
      createTask(input: $task) { id title status }
      putTextArtifact(input: $artifact) { id path title }
    }`,
    {
      project: {
        slug: projectSlug,
        title: `Gateway GraphQL Smoke ${unique}`
      },
      task: {
        project: projectSlug,
        title: "Gateway GraphQL smoke task",
        scope: "Verify GraphQL task list.",
        acceptance: "GraphQL returns this task.",
        priority: 1
      },
      artifact: {
        project: projectSlug,
        path: "docs/graphql-smoke.md",
        title: "GraphQL Smoke Artifact",
        text: "# GraphQL Smoke\n\nThis text should be readable without base64.",
        contentType: "text/markdown; charset=utf-8",
        tags: ["smoke", "graphql"]
      }
    }
  );
  projectId = created.createProject.id;
  const taskId = created.createTask.id;
  const artifactId = created.putTextArtifact.id;
  assert(created.createTask.status === "todo", "GraphQL createTask did not create a todo task.");
  console.log("ok - graphql create mutations");

  const memoryCreated = await graphql<{ createMemory: { id: string } }>(
    `mutation CreateMemory($project: String!) {
      createMemory(input: {
        project: $project,
        type: "note",
        title: "GraphQL pagination smoke memory",
        body: "GraphQL pagination smoke memory validates memorySearchPage totalCount and items.",
        tags: ["smoke", "graphql", "pagination"]
      }) { id }
    }`,
    { project: projectId }
  );
  const memoryId = memoryCreated.createMemory.id;
  assert(memoryId.startsWith("I-"), "GraphQL createMemory did not return an I-* item.");
  const linkCreated = await graphql<{ createLink: { id: string } }>(
    `mutation CreateLink($project: String!, $fromId: String!, $toId: String!) {
      createLink(input: { project: $project, fromId: $fromId, toId: $toId, relation: "documents" }) { id }
    }`,
    { project: projectId, fromId: memoryId, toId: taskId }
  );
  const linkId = linkCreated.createLink.id;
  assert(linkId.startsWith("L-"), "GraphQL createLink did not return an L-* link.");
  const dependencyCreated = await graphql<{ createTask: { id: string; dependsOn: string[] } }>(
    `mutation CreateDependentTask($task: CreateTaskInput!) {
      createTask(input: $task) { id dependsOn }
    }`,
    {
      task: {
        project: projectId,
        title: "Gateway GraphQL smoke dependent task",
        dependsOn: [taskId],
        priority: 2
      }
    }
  );
  const dependentTaskId = dependencyCreated.createTask.id;
  assert(dependencyCreated.createTask.dependsOn.includes(taskId), "GraphQL createTask did not persist dependsOn.");

  const data = await graphql<{
    project: { id: string; slug: string; title: string };
    tasks: Array<{ id: string; title: string; status: string }>;
    artifactText: { path: string; text: string; textInfo: { base64Included: boolean } };
    projectSummary: {
      project: { id: string };
      counts: { tasks: number; artifacts: number };
      openTasks: Array<{ id: string; title: string }>;
    };
  }>(
    `query Smoke($project: String!, $path: String!) {
      project(slug: "${projectSlug}") { id slug title }
      tasks(project: $project) { id title status }
      artifactText(project: $project, path: $path, maxBytes: 2000) {
        path
        text
        textInfo { base64Included }
      }
      projectSummary(project: $project) {
        project { id }
        counts { tasks artifacts }
        openTasks { id title }
      }
    }`,
    { project: projectId, path: "docs/graphql-smoke.md" }
  );

  assert(data.project.id === projectId, "GraphQL project query returned wrong project.");
  assert(data.tasks.some((task) => task.title === "Gateway GraphQL smoke task"), "GraphQL tasks query missed smoke task.");
  assert(data.artifactText.text.includes("readable without base64"), "GraphQL artifactText did not return text.");
  assert(data.artifactText.textInfo.base64Included === false, "GraphQL artifactText included base64.");
  assert(data.projectSummary.counts.tasks >= 1, "GraphQL projectSummary did not report task count.");
  assert(data.projectSummary.counts.artifacts >= 1, "GraphQL projectSummary did not report artifact count.");
  console.log("ok - graphql project explorer queries");

  const claimTaskCreated = await graphql<{ createTask: { id: string; status: string; activeClaimCount: number } }>(
    `mutation ClaimTask($task: CreateTaskInput!) {
      createTask(input: $task) { id status activeClaimCount }
    }`,
    {
      task: {
        project: projectId,
        title: "Gateway GraphQL smoke claimed task",
        acceptance: "Claim flow can complete this task.",
        priority: 3
      }
    }
  );
  const claimTaskId = claimTaskCreated.createTask.id;
  assert(claimTaskCreated.createTask.activeClaimCount === 0, "GraphQL createTask returned unexpected activeClaimCount.");
  const claimed = await graphql<{
    claimTask: { claim: { id: string; status: string; role: string }; task: { id: string; status: string; activeClaimCount: number } };
  }>(
    `mutation ClaimTaskFlow($input: TaskClaimInput!) {
      claimTask(input: $input) {
        claim { id status role }
        task { id status activeClaimCount }
      }
    }`,
    {
      input: {
        taskId: claimTaskId,
        role: "test",
        scope: "GraphQL smoke claim flow",
        leaseSeconds: 600
      }
    }
  );
  const claimId = claimed.claimTask.claim.id;
  assert(claimed.claimTask.claim.status === "active", "GraphQL claimTask did not create an active claim.");
  assert(claimed.claimTask.task.status === "doing", "GraphQL claimTask did not move todo task to doing.");
  assert(claimed.claimTask.task.activeClaimCount === 1, "GraphQL claimTask did not increment activeClaimCount.");
  const heartbeat = await graphql<{ heartbeatTaskClaim: { id: string; status: string; note: string | null } }>(
    `mutation ClaimHeartbeat($claimId: ID!) {
      heartbeatTaskClaim(claimId: $claimId, leaseSeconds: 600, note: "GraphQL smoke heartbeat.") {
        id
        status
        note
      }
    }`,
    { claimId }
  );
  assert(heartbeat.heartbeatTaskClaim.status === "active", "GraphQL heartbeatTaskClaim did not keep claim active.");
  assert(heartbeat.heartbeatTaskClaim.note?.includes("heartbeat"), "GraphQL heartbeatTaskClaim did not append note.");
  const taskNote = await graphql<{ addTaskNote: { item: { id: string; type: string }; link: { fromId: string; toId: string; relation: string } } }>(
    `mutation AddTaskNote($input: TaskNoteInput!) {
      addTaskNote(input: $input) {
        item { id type }
        link { fromId toId relation }
      }
    }`,
    {
      input: {
        taskId: claimTaskId,
        type: "test_result",
        body: "GraphQL smoke verified task claim note creation."
      }
    }
  );
  assert(taskNote.addTaskNote.item.id.startsWith("I-"), "GraphQL addTaskNote did not create memory item.");
  assert(taskNote.addTaskNote.link.toId === claimTaskId, "GraphQL addTaskNote did not link note to task.");
  assert(taskNote.addTaskNote.link.relation === "test_result_for", "GraphQL addTaskNote used wrong default relation.");
  const claims = await graphql<{ taskClaims: Array<{ id: string; status: string }> }>(
    `query TaskClaims($taskId: ID!) {
      taskClaims(taskId: $taskId) { id status }
    }`,
    { taskId: claimTaskId }
  );
  assert(claims.taskClaims.some((claim) => claim.id === claimId), "GraphQL taskClaims missed active claim.");
  const completedClaimTask = await graphql<{
    completeTask: { task: { id: string; status: string; activeClaimCount: number }; completedClaim: { id: string; status: string } | null };
  }>(
    `mutation CompleteClaimedTask($taskId: ID!, $claimId: ID!) {
      completeTask(id: $taskId, claimId: $claimId, acceptanceEvidence: "GraphQL smoke claim flow passed.") {
        task { id status activeClaimCount }
        completedClaim { id status }
      }
    }`,
    { taskId: claimTaskId, claimId }
  );
  assert(completedClaimTask.completeTask.task.status === "done", "GraphQL completeTask did not close claimed task.");
  assert(completedClaimTask.completeTask.task.activeClaimCount === 0, "GraphQL completeTask left active claims.");
  assert(completedClaimTask.completeTask.completedClaim?.status === "completed", "GraphQL completeTask did not complete claim.");
  console.log("ok - graphql task claim flow");

  const graph = await graphql<{
    projectGraph: {
      nodes: Array<{ id: string; kind: string; title: string; status: string | null; createdAt: string | null }>;
      edges: Array<{ from: string; to: string; relation: string }>;
    };
  }>(
    `query ProjectGraph($projectId: ID!) {
      projectGraph(projectId: $projectId, depth: 2) {
        nodes { id kind title status createdAt }
        edges { from to relation }
      }
    }`,
    { projectId }
  );
  const graphNodeIds = graph.projectGraph.nodes.map((node) => node.id);
  assert(graphNodeIds.includes(projectId), "GraphQL projectGraph missed project node.");
  assert(graphNodeIds.includes(taskId), "GraphQL projectGraph missed task node.");
  assert(graphNodeIds.includes(dependentTaskId), "GraphQL projectGraph missed dependent task node.");
  assert(graphNodeIds.includes(memoryId), "GraphQL projectGraph missed memory node.");
  assert(
    graph.projectGraph.nodes.every((node) => typeof node.createdAt === "string" && node.createdAt.length > 0),
    "GraphQL projectGraph node is missing createdAt (needed for the horizontal timeline view, I-PMEM-011)."
  );
  assert(
    graph.projectGraph.edges.some((edge) => edge.from === memoryId && edge.to === taskId && edge.relation === "documents"),
    "GraphQL projectGraph missed link edge."
  );
  assert(
    graph.projectGraph.edges.some((edge) => edge.from === taskId && edge.to === dependentTaskId && edge.relation === "blocks"),
    "GraphQL projectGraph missed task dependency edge."
  );
  assert(
    graph.projectGraph.nodes.every((node) => node.kind !== "EVENT"),
    "GraphQL projectGraph should exclude EVENT nodes (I-MEMORY-022 step 3: events are bookkeeping, not graph edges)."
  );
  console.log("ok - graphql project graph query");

  const recordNavigation = await graphql<{
    taskRecord: { kind: string; record: { __typename: string; id: string; title: string; scope: string | null } };
    artifactRecord: { kind: string; record: { __typename: string; id: string; path: string } };
    memory: { id: string; body: string };
    link: { id: string; fromId: string; toId: string; relation: string };
  }>(
    `query RecordNavigation($taskId: ID!, $artifactId: ID!, $memoryId: ID!, $linkId: ID!) {
      taskRecord: record(id: $taskId) {
        kind
        record {
          __typename
          ... on Task { id title scope }
          ... on MemoryRecord { id title scope }
          ... on Artifact { id title scope }
          ... on Event { id title }
        }
      }
      artifactRecord: record(id: $artifactId) {
        kind
        record {
          __typename
          ... on Artifact { id path }
        }
      }
      memory(id: $memoryId) { id body }
      link(id: $linkId) { id fromId toId relation }
    }`,
    { taskId, artifactId, memoryId, linkId }
  );
  assert(recordNavigation.taskRecord.kind === "TASK", "GraphQL record did not resolve task kind.");
  assert(recordNavigation.taskRecord.record.__typename === "Task", "GraphQL record did not resolve Task payload.");
  assert(recordNavigation.artifactRecord.kind === "ARTIFACT", "GraphQL record did not resolve artifact kind.");
  assert(recordNavigation.artifactRecord.record.path === "docs/graphql-smoke.md", "GraphQL record returned wrong artifact.");
  assert(recordNavigation.memory.body.includes("validates memorySearchPage"), "GraphQL memory(id) did not return body.");
  assert(recordNavigation.link.fromId === memoryId && recordNavigation.link.toId === taskId, "GraphQL link(id) returned wrong endpoints.");
  console.log("ok - graphql record navigation queries");

  const pages = await graphql<{
    projectsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    gatewayClientsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    tasksPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    artifactsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    artifactSearchPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    memoryItemsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    memorySearchPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    eventsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    links: Array<{ id: string; fromId: string; toId: string; relation: string }>;
    linksPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
  }>(
    `query Pages($project: String!, $memoryId: ID!) {
      projectsPage(status: "active", pagination: { limit: 2, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      gatewayClientsPage(pagination: { limit: 5, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      tasksPage(project: $project, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      artifactsPage(project: $project, includeArchived: true, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      artifactSearchPage(project: $project, query: "GraphQL", includeArchived: true, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      memoryItemsPage(project: $project, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      memorySearchPage(project: $project, query: "GraphQL pagination smoke", pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      eventsPage(project: $project, pagination: { limit: 2, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      links(id: $memoryId) {
        id
        fromId
        toId
        relation
      }
      linksPage(project: $project, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
    }`,
    { project: projectId, memoryId }
  );
  assertPage(pages.projectsPage.pageInfo, 2, 0, 1, "projectsPage");
  assertPage(pages.gatewayClientsPage.pageInfo, 5, 0, 1, "gatewayClientsPage");
  assertPage(pages.tasksPage.pageInfo, 1, 0, 1, "tasksPage");
  assertPage(pages.artifactsPage.pageInfo, 1, 0, 1, "artifactsPage");
  assertPage(pages.artifactSearchPage.pageInfo, 1, 0, 1, "artifactSearchPage");
  assertPage(pages.memoryItemsPage.pageInfo, 1, 0, 1, "memoryItemsPage");
  assertPage(pages.memorySearchPage.pageInfo, 1, 0, 1, "memorySearchPage");
  assertPage(pages.eventsPage.pageInfo, 2, 0, 1, "eventsPage");
  assert(pages.links.some((link) => link.id === linkId), "GraphQL links query missed smoke link.");
  assertPage(pages.linksPage.pageInfo, 1, 0, 1, "linksPage");
  console.log("ok - graphql paginated table queries");

  const updated = await graphql<{
    updateTaskStatus: { id: string; status: string };
    updateArtifactMetadata: { id: string; title: string; tags: string[] };
    archiveArtifact: { action: string; artifact: { id: string; status: string } };
  }>(
    `mutation UpdateSmoke($taskId: ID!, $artifactId: ID!) {
      updateTaskStatus(id: $taskId, status: "doing", note: "GraphQL smoke status update.") { id status }
      updateArtifactMetadata(input: { id: $artifactId, title: "GraphQL Smoke Artifact Updated", tags: ["smoke", "graphql", "updated"] }) {
        id
        title
        tags
      }
      archiveArtifact(id: $artifactId, reason: "GraphQL smoke archive.") {
        action
        artifact { id status }
      }
    }`,
    { taskId, artifactId }
  );
  assert(updated.updateTaskStatus.status === "doing", "GraphQL updateTaskStatus did not update status.");
  assert(updated.updateArtifactMetadata.title === "GraphQL Smoke Artifact Updated", "GraphQL updateArtifactMetadata did not update title.");
  assert(updated.archiveArtifact.artifact.status === "archived", "GraphQL archiveArtifact did not archive artifact.");
  console.log("ok - graphql update/archive mutations");

  const supersedeOriginal = await graphql<{ recordDecision: { id: string } }>(
    `mutation SupersedeOriginal($project: String!) {
      recordDecision(input: {
        project: $project,
        title: "GraphQL smoke supersede: original",
        decision: "Original smoke decision for the supersedeDecision mutation."
      }) { id }
    }`,
    { project: projectId }
  );
  const supersedeOriginalId = supersedeOriginal.recordDecision.id;
  const supersedeResult = await graphql<{
    supersedeDecision: {
      decision: { id: string; status: string; supersedesId: string | null };
      superseded: { id: string; status: string };
      link: { fromId: string; toId: string; relation: string };
      event: { type: string };
    };
  }>(
    `mutation SupersedeReplacement($project: String!, $supersedesId: String!) {
      supersedeDecision(input: {
        project: $project,
        supersedesId: $supersedesId,
        title: "GraphQL smoke supersede: replacement",
        decision: "Replacement smoke decision.",
        rationale: "GraphQL should expose decision.supersede, not just decision.record."
      }) {
        decision { id status supersedesId }
        superseded { id status }
        link { fromId toId relation }
        event { type }
      }
    }`,
    { project: projectId, supersedesId: supersedeOriginalId }
  );
  assert(
    supersedeResult.supersedeDecision.decision.supersedesId === supersedeOriginalId,
    "GraphQL supersedeDecision did not link the replacement to the original."
  );
  assert(
    supersedeResult.supersedeDecision.superseded.status === "superseded",
    "GraphQL supersedeDecision did not mark the original as superseded."
  );
  assert(
    supersedeResult.supersedeDecision.link.relation === "supersedes",
    "GraphQL supersedeDecision did not return a supersedes link."
  );
  console.log("ok - graphql supersedeDecision mutation");

  const maintenanceCreated = await graphql<{
    recordDecision: { id: string; status: string };
    recordEvent: { id: string; type: string };
    putTextArtifact: { id: string };
  }>(
    `mutation MaintenanceCreate($project: String!) {
      recordDecision(input: {
        project: $project,
        title: "GraphQL maintenance smoke decision",
        decision: "Exercise archive and hard-delete mutations.",
        tags: ["smoke", "graphql", "maintenance"]
      }) { id status }
      recordEvent(input: {
        project: $project,
        type: "graphql.smoke.event",
        title: "GraphQL smoke event",
        body: "This event should be hard-deleted by smoke."
      }) { id type }
      putTextArtifact(input: {
        project: $project,
        path: "docs/graphql-delete-smoke.md",
        title: "GraphQL Delete Smoke Artifact",
        text: "temporary delete smoke artifact",
        contentType: "text/markdown; charset=utf-8",
        tags: ["smoke", "graphql", "delete"]
      }) { id }
    }`,
    { project: projectId }
  );
  const decisionId = maintenanceCreated.recordDecision.id;
  const eventId = maintenanceCreated.recordEvent.id;
  const deleteArtifactId = maintenanceCreated.putTextArtifact.id;
  const maintenanceDeleted = await graphql<{
    archiveMemory: { action: string; memory: { id: string; status: string } };
    archiveDecision: { action: string; decision: { id: string; status: string } };
    deleteLink: { deletedLink: { id: string }; event: { type: string } };
    deleteEvent: { deletedEvent: { id: string } };
    deleteArtifact: { deletedArtifact: { id: string }; deletedLinks: number; event: { type: string } };
    deleteMemory: { deletedMemory: { id: string }; deletedLinks: number; event: { type: string } };
    deleteDecision: { deletedDecision: { id: string }; deletedLinks: number; event: { type: string } };
  }>(
    `mutation MaintenanceDelete($memoryId: ID!, $decisionId: ID!, $linkId: ID!, $eventId: ID!, $artifactId: ID!) {
      archiveMemory(id: $memoryId, reason: "GraphQL smoke archive memory.") {
        action
        memory { id status }
      }
      archiveDecision(id: $decisionId, reason: "GraphQL smoke archive decision.") {
        action
        decision { id status }
      }
      deleteLink(id: $linkId, reason: "GraphQL smoke delete link.") {
        deletedLink { id }
        event { type }
      }
      deleteEvent(id: $eventId, reason: "GraphQL smoke delete event.") {
        deletedEvent { id }
      }
      deleteArtifact(id: $artifactId, reason: "GraphQL smoke hard-delete artifact.") {
        deletedArtifact { id }
        deletedLinks
        event { type }
      }
      deleteMemory(id: $memoryId, reason: "GraphQL smoke hard-delete memory.") {
        deletedMemory { id }
        deletedLinks
        event { type }
      }
      deleteDecision(id: $decisionId, reason: "GraphQL smoke hard-delete decision.") {
        deletedDecision { id }
        deletedLinks
        event { type }
      }
    }`,
    { memoryId, decisionId, linkId, eventId, artifactId: deleteArtifactId }
  );
  assert(maintenanceDeleted.archiveMemory.memory.status === "archived", "GraphQL archiveMemory did not archive memory.");
  assert(maintenanceDeleted.archiveDecision.decision.status === "archived", "GraphQL archiveDecision did not archive decision.");
  assert(maintenanceDeleted.deleteLink.deletedLink.id === linkId, "GraphQL deleteLink returned wrong link.");
  assert(maintenanceDeleted.deleteEvent.deletedEvent.id === eventId, "GraphQL deleteEvent returned wrong event.");
  assert(maintenanceDeleted.deleteArtifact.deletedArtifact.id === deleteArtifactId, "GraphQL deleteArtifact returned wrong artifact.");
  assert(maintenanceDeleted.deleteMemory.deletedMemory.id === memoryId, "GraphQL deleteMemory returned wrong memory.");
  assert(maintenanceDeleted.deleteDecision.deletedDecision.id === decisionId, "GraphQL deleteDecision returned wrong decision.");
  console.log("ok - graphql maintenance archive/delete mutations");

  const tempTask = await graphql<{ createTask: { id: string } }>(
    `mutation TempTask($task: CreateTaskInput!) {
      createTask(input: $task) { id }
    }`,
    {
      task: {
        project: projectId,
        title: "Gateway GraphQL smoke delete task",
        priority: 99
      }
    }
  );
  const deletedTask = await graphql<{ deleteTask: { deletedTask: { id: string }; event: { id: string; type: string } } }>(
    `mutation DeleteTask($id: ID!) {
      deleteTask(id: $id, reason: "GraphQL smoke task cleanup.") {
        deletedTask { id }
        event { id type }
      }
    }`,
    { id: tempTask.createTask.id }
  );
  assert(deletedTask.deleteTask.deletedTask.id === tempTask.createTask.id, "GraphQL deleteTask returned wrong task.");
  const eventLookup = await graphql<{ event: { id: string; type: string }; eventRecord: { kind: string; record: { __typename: string; id: string } } }>(
    `query EventLookup($id: ID!) {
      event(id: $id) { id type }
      eventRecord: record(id: $id) {
        kind
        record {
          __typename
          ... on Event { id }
        }
      }
    }`,
    { id: deletedTask.deleteTask.event.id }
  );
  assert(eventLookup.event.type === "task.deleted", "GraphQL event(id) returned wrong event.");
  assert(eventLookup.eventRecord.kind === "EVENT", "GraphQL record did not resolve event kind.");
  console.log("ok - graphql deleteTask mutation");

  const deleted = await graphql<{ deleteProject: { deletedProject: { id: string }; cascade: boolean } }>(
    `mutation DeleteProject($id: ID!) {
      deleteProject(id: $id, cascade: true, reason: "Gateway GraphQL smoke cleanup.") {
        deletedProject { id }
        cascade
      }
    }`,
    { id: projectId }
  );
  assert(deleted.deleteProject.deletedProject.id === projectId, "GraphQL deleteProject returned wrong project.");
  projectId = undefined;
  console.log("ok - graphql deleteProject cleanup");

  console.log(`Gateway GraphQL smoke test passed using ${graphqlUrl}`);
} finally {
  if (projectId) {
    const cleanup = await callGateway("project.delete", {
      id: projectId,
      cascade: true,
      reason: "Gateway GraphQL smoke cleanup after failure."
    });
    if (!cleanup.ok) {
      await db("projects").where({ id: projectId }).del();
    }
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await started.stop();
  await service.close();
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway GraphQL Smoke",
      "x-project-memory-client-kind": "smoke"
    },
    body: JSON.stringify({ query, variables })
  });
  assert(response.ok, `GraphQL HTTP request returned ${response.status}.`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  assert(body.data, "GraphQL response did not include data.");
  return body.data;
}

async function callGateway(tool: string, input: unknown): Promise<ToolResponse<unknown>> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway GraphQL Smoke",
      "x-project-memory-client-kind": "smoke"
    },
    body: JSON.stringify({ tool, input })
  });
  assert(response.ok, `Gateway call ${tool} returned HTTP ${response.status}.`);
  return (await response.json()) as ToolResponse<unknown>;
}

type PageInfo = {
  limit: number;
  offset: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

function assertPage(pageInfo: PageInfo, limit: number, offset: number, minTotalCount: number, label: string): void {
  assert(pageInfo.limit === limit, `${label} returned wrong limit.`);
  assert(pageInfo.offset === offset, `${label} returned wrong offset.`);
  assert(pageInfo.totalCount >= minTotalCount, `${label} returned too small totalCount.`);
  assert(pageInfo.hasPreviousPage === (offset > 0), `${label} returned wrong hasPreviousPage.`);
  assert(
    pageInfo.hasNextPage === offset + limit < pageInfo.totalCount,
    `${label} returned wrong hasNextPage.`
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
