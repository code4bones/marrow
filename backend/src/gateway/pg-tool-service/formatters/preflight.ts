import { preferredArtifactReadTool } from "./artifacts.js";
import { capNextCalls } from "./common.js";
import type { Row } from "../types.js";

export function mustReadPointers(faults: Row[]) {
  return faults.slice(0, 5).map((fault) => ({
    kind: "failed_attempt",
    id: String(fault.id),
    title: String(fault.title),
    tool: "memory.get",
    reason: "Known fault matched this task/query. Read before repeating related approaches."
  }));
}


export function contextPackNextCalls(input: { decisions: Row[]; faults: Row[]; artifacts: Row[]; task: Row | null }) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [];
  for (const fault of input.faults.slice(0, 3)) {
    calls.push({
      tool: "memory.get",
      input: { id: String(fault.id) },
      reason: "Read full failed-attempt details before proceeding."
    });
  }
  for (const artifact of input.artifacts.slice(0, 5)) {
    const tool = preferredArtifactReadTool(artifact);
    calls.push({
      tool,
      input: { id: String(artifact.id) },
      reason:
        tool === "artifact.read_text"
          ? "Read bounded text from shared artifact without loading base64 content."
          : "Preview shared artifact before requesting full base64 content or downloading."
    });
  }
  for (const decision of input.decisions.slice(0, 3)) {
    calls.push({
      tool: "decision.get",
      input: { id: String(decision.id) },
      reason: "Read full decision only if the compact decision card affects the implementation."
    });
  }
  if (input.task?.id) {
    calls.push({
      tool: "preflight",
      input: { taskId: String(input.task.id) },
      reason: "Use full preflight when allowed/forbidden scope or complete context is needed."
    });
  }
  return capNextCalls(calls);
}


export function changedSinceNextCalls(input: {
  project: Row | null;
  memory: Row[];
  handoffs: Row[];
  decisions: Row[];
  artifacts: Row[];
}) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [];
  if (input.project) {
    calls.push({
      tool: "project.summary",
      input: { project: String(input.project.id) },
      reason: "Reload compact project state if the incremental changes are not enough."
    });
  }
  for (const item of [...input.memory, ...input.handoffs].slice(0, 3)) {
    calls.push({
      tool: "memory.get",
      input: { id: String(item.id) },
      reason: "Read full memory body only when the compact changed card is insufficient."
    });
  }
  for (const artifact of input.artifacts.slice(0, 3)) {
    const tool = preferredArtifactReadTool(artifact);
    calls.push({
      tool,
      input: { id: String(artifact.id) },
      reason:
        tool === "artifact.read_text"
          ? "Read bounded text from changed artifact without loading base64 content."
          : "Preview changed artifact before requesting full content."
    });
  }
  for (const decision of input.decisions.slice(0, 2)) {
    calls.push({
      tool: "decision.get",
      input: { id: String(decision.id) },
      reason: "Read full decision when the compact changed card affects current work."
    });
  }
  return calls;
}


export function contextPackLimits(mode: string, overrides: Row) {
  const defaults =
    mode === "brief"
      ? { decisions: 3, items: 4, failedAttempts: 3, artifacts: 3, events: 3, handoffs: 1 }
      : mode === "deep"
        ? { decisions: 10, items: 12, failedAttempts: 8, artifacts: 10, events: 10, handoffs: 3 }
        : { decisions: 5, items: 6, failedAttempts: 5, artifacts: 5, events: 5, handoffs: 2 };
  return {
    decisions: Number(overrides.decisions ?? defaults.decisions),
    items: Number(overrides.items ?? defaults.items),
    failedAttempts: Number(overrides.failedAttempts ?? defaults.failedAttempts),
    artifacts: Number(overrides.artifacts ?? defaults.artifacts),
    events: Number(overrides.events ?? defaults.events),
    handoffs: Number(overrides.handoffs ?? defaults.handoffs)
  };
}

