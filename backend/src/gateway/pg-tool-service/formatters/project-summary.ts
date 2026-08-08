import { preferredArtifactReadTool } from "./artifacts.js";
import type { Row } from "../types.js";

export function projectSummaryNextCalls(input: {
  project: Row;
  query: string;
  openTasks: Row[];
  knownFaults: Row[];
  artifacts: Row[];
  decisions: Row[];
}) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [
    {
      tool: "context.pack",
      input: { project: String(input.project.id), query: input.query, mode: "normal" },
      reason: "Load a focused compact context pack before implementation work."
    },
    {
      tool: "handoff.latest",
      input: { project: String(input.project.id), limit: 3 },
      reason: "Check recent continuation points before broad search."
    }
  ];
  for (const task of input.openTasks.slice(0, 2)) {
    calls.push({
      tool: "preflight",
      input: { taskId: String(task.id) },
      reason: "Use full task preflight before editing files for this task."
    });
  }
  for (const fault of input.knownFaults.slice(0, 3)) {
    calls.push({
      tool: "memory.get",
      input: { id: String(fault.id) },
      reason: "Read full failed-attempt details before repeating related work."
    });
  }
  for (const artifact of input.artifacts.slice(0, 3)) {
    const tool = preferredArtifactReadTool(artifact);
    calls.push({
      tool,
      input: { id: String(artifact.id) },
      reason:
        tool === "artifact.read_text"
          ? "Read bounded text from shared artifact without loading base64 content."
          : "Preview shared artifact before requesting full content."
    });
  }
  for (const decision of input.decisions.slice(0, 2)) {
    calls.push({
      tool: "decision.get",
      input: { id: String(decision.id) },
      reason: "Read full decision if the compact card affects the task."
    });
  }
  return calls;
}


export function projectSummaryLimits(overrides: Row) {
  return {
    tasks: Number(overrides.tasks ?? 8),
    decisions: Number(overrides.decisions ?? 5),
    faults: Number(overrides.faults ?? 5),
    handoffs: Number(overrides.handoffs ?? 3),
    artifacts: Number(overrides.artifacts ?? 5),
    memory: Number(overrides.memory ?? 6),
    events: Number(overrides.events ?? 5)
  };
}

