import { describe, expect, it } from "vitest";
import { chatRecipients, recipientKeys } from "../src/gateway/telegram-project-bots/recipients.js";
import { resolveTelegramRecipient } from "../src/gateway/telegram-project-bots/members.js";

const sender = { mention_key: "22", username: "alex", label: "Alex (@alex)", user_id: null, assignment_tags: [], source_type: "sender", last_seen_at: "2026-10-26T10:00:00Z" };
const mention = { mention_key: "username:alex", username: null, label: "@alex", user_id: "member", assignment_tags: '["бэк"]', source_type: "mention", last_seen_at: "2026-10-26T11:00:00Z" };
describe("one Telegram recipient per identity", () => {
  it("combines a configured @mention with a sender without losing account, tags or latest activity", () => {
    const rows = chatRecipients([sender, mention]);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ mention_key: "22", label: "Alex (@alex)", user_id: "member", assignment_tags: ["бэк"], last_seen_at: mention.last_seen_at, mapping_conflict: false });
    expect(recipientKeys(rows[0])).toEqual(["22", "username:alex"]);
    expect(resolveTelegramRecipient("22", null, rows, [], new Set(["owner", "member"]), "owner")).toMatchObject({ userId: "member", resolution: "manual" });
    expect(resolveTelegramRecipient("username:alex", "alex", rows, [], new Set(["owner", "member"]), "owner")).toMatchObject({ userId: "member", resolution: "manual" });
    expect(sender.user_id).toBeNull();
  });
  it("unions compatible tags and treats conflicting account mappings as owner fallback", () => {
    const rows = chatRecipients([{ ...sender, user_id: "member", assignment_tags: ["проверка"] }, mention]);
    expect(rows[0].assignment_tags).toEqual(["проверка", "бэк"]);
    const conflict = chatRecipients([{ ...sender, user_id: "other", assignment_tags: ["проверка"] }, mention]);
    expect(conflict).toHaveLength(1); expect(conflict[0]).toMatchObject({ user_id: null, mapping_conflict: true });
    expect(resolveTelegramRecipient("username:alex", "alex", conflict, [], new Set(["owner", "member", "other"]), "owner")).toMatchObject({ userId: "owner", resolution: "owner" });
  });
  it("keeps two distinct Telegram IDs separate even if names or mapped Marrow accounts match", () => {
    const rows = chatRecipients([{ ...sender, user_id: "member" }, { ...sender, mention_key: "33", user_id: "member" }, mention]);
    expect(rows).toHaveLength(3); expect(rows.map((r) => r.mention_key).sort()).toEqual(["22", "33", "username:alex"]);
  });
  it("does not resurrect tags of a deleted account when another alias is mapped", () => {
    const rows = chatRecipients([{ ...sender, assignment_tags: ["старый"] }, mention]);
    expect(rows[0].assignment_tags).toEqual(["бэк"]);
  });
});
