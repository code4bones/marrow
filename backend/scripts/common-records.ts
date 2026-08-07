export const commonRecords = [
  {
    id: "C-AGENT-001",
    type: "agent_rule",
    title: "Always run preflight before task execution",
    body: "Before starting an implementation task, call preflight to load task scope, decisions, common rules, failed attempts, and acceptance criteria.",
    tags: ["common", "agent", "workflow"]
  },
  {
    id: "C-AGENT-002",
    type: "agent_rule",
    title: "Keep diffs small and reviewable",
    body: "Agents should prefer small, reviewable changes and avoid unrelated refactors unless explicitly requested.",
    tags: ["common", "agent", "workflow"]
  },
  {
    id: "C-AGENT-003",
    type: "agent_rule",
    title: "Do not expand scope without explicit request",
    body: "If a task has explicit scope, do not add extra features or rewrite unrelated files without a direct request.",
    tags: ["common", "agent", "scope"]
  },
  {
    id: "C-AGENT-004",
    type: "agent_rule",
    title: "Record failed attempts",
    body: "When an approach fails in a useful way, record what was tried, why it failed, and what should not be repeated.",
    tags: ["common", "agent", "failed_attempt"]
  },
  {
    id: "C-AGENT-STATE-001",
    type: "workflow_rule",
    title: "State machine: resolve current project first",
    body: "Agent state S0_NO_PROJECT must transition through project.current. If no current project exists, use project.list or project.create followed by project.set_current. Ask the user only when multiple plausible projects exist or repository identity is unclear.",
    tags: ["common", "agent", "state_machine", "project"]
  },
  {
    id: "C-AGENT-STATE-002",
    type: "workflow_rule",
    title: "State machine: select a task before preflight",
    body: "Agent state S1_PROJECT_SELECTED should transition with task.next, task.list, or task.get before preflight. Ask the user only when no todo task exists and the user did not provide a concrete task.",
    tags: ["common", "agent", "state_machine", "task"]
  },
  {
    id: "C-AGENT-STATE-003",
    type: "workflow_rule",
    title: "State machine: run preflight before editing",
    body: "Agent state S2_TASK_SELECTED must transition through preflight before editing files. If preflight shows no blocking conflict, update the task to doing and implement within allowed scope.",
    tags: ["common", "agent", "state_machine", "preflight"]
  },
  {
    id: "C-AGENT-STATE-004",
    type: "workflow_rule",
    title: "State machine: ask only on guard conflicts",
    body: "Do not ask for clarification during the normal path project.current -> task.next -> preflight -> doing -> validate -> done. Ask when project/task identity is ambiguous, scope is contradictory, forbidden files are required, decisions conflict, failed attempts match the intended approach, dependencies are blocked, or validation requires an architecture decision.",
    tags: ["common", "agent", "state_machine", "clarification"]
  },
  {
    id: "C-AGENT-STATE-005",
    type: "workflow_rule",
    title: "State machine: record blocked or failed attempts",
    body: "When execution is blocked or an approach fails in a reusable way, update the task to blocked if needed, create a failed_attempt memory item, record an attempt.failed event, and link the failed attempt to the task or decision with warns_against.",
    tags: ["common", "agent", "state_machine", "failed_attempt"]
  },
  {
    id: "C-TASK-001",
    type: "workflow_rule",
    title: "Every task needs acceptance criteria",
    body: "Executable tasks should state what done means so an agent can validate completion.",
    tags: ["common", "task", "definition-of-done"]
  },
  {
    id: "C-TASK-002",
    type: "workflow_rule",
    title: "Allowed and forbidden files should be explicit",
    body: "When possible, tasks should identify files or areas that are allowed and forbidden for the implementation.",
    tags: ["common", "task", "scope"]
  },
  {
    id: "C-TEMPLATE-001",
    type: "template_index",
    title: "Bundled template artifacts index",
    body:
      "Project Memory bundled templates are stored as common artifacts on the gateway, not as memory item bodies. To find templates, agents should call artifact.list with { common: true, pathPrefix: \"templates\" } or artifact.search with queries such as \"template\", \"frontend AGENTS template\", \"handoff template\", \"task template\", \"deploy checklist\", or \"review checklist\" and includeCommon=true. Russian запросы like \"шаблон\" mean template; use artifact.search query=\"template\" if Cyrillic search returns no results. Current bundled artifact paths include templates/agents/generic/AGENTS.md, templates/agents/frontend/AGENTS.md, templates/agents/backend/AGENTS.md, templates/agents/devops/AGENTS.md, templates/review/REVIEW_CHECKLIST.md, templates/deploy/DEPLOY_CHECKLIST.md, templates/release/RELEASE_CHECKLIST.md, templates/task/TASK_TEMPLATE.md, templates/handoff/HANDOFF_TEMPLATE.md, and templates/fault/FAULT_TEMPLATE.md.",
    tags: ["template", "templates", "artifact", "artifacts", "agents", "handoff", "task", "review", "deploy", "шаблон"]
  },
  {
    id: "C-ARCH-001",
    type: "architecture_note",
    title: "Prefer feature-oriented architecture",
    body: "Split code by business capability. Keep reusable infrastructure in shared and feature logic inside features.",
    tags: ["common", "architecture"]
  },
  {
    id: "C-ARCH-002",
    type: "architecture_note",
    title: "Shared code must be genuinely reusable",
    body: "Do not turn shared into a dumping ground. Shared modules should be reusable infrastructure or small generic helpers.",
    tags: ["common", "architecture"]
  }
];
