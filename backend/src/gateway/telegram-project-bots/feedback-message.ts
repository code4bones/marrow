import type { InputRichMessage } from "grammy/types";
import type { TelegramTaskFeedback } from "./feedback.js";
import { telegramPeopleText } from "./participant-references.js";

export function taskFeedbackMessage(payload: TelegramTaskFeedback, webUrl: string): InputRichMessage {
  const headings = { done: "✅ Задача выполнена", clar: "❓ Требуется уточнение · CLAR",
    handoff: "🔄 Задача передана", reassigned: "👥 Исполнители изменены" };
  return { blocks: [
    { type: "heading", size: 3, text: headings[payload.status] },
    { type: "paragraph", text: [{ type: "code", text: payload.taskId }, `: ${payload.title}`] },
    { type: "paragraph", text: [payload.status === "clar" ? "Уточнение запрашивает: " : payload.status === "handoff" ? "От: " : payload.status === "done" ? "Завершили: " : "Предыдущие исполнители: ", telegramPeopleText(payload.from)] },
    ...(payload.status === "handoff" || payload.status === "reassigned" ? [{ type: "paragraph" as const, text: ["Передано: ", telegramPeopleText(payload.to)] }] : []),
    ...(payload.note ? [{ type: "paragraph" as const, text: payload.note }] : []),
    { type: "paragraph", text: { type: "url", text: "Открыть задачу в Marrow →", url: `${webUrl}/projects/${encodeURIComponent(payload.projectSlug)}/tasks/${encodeURIComponent(payload.taskId)}` } }
  ] };
}
