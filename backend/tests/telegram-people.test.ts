import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rememberChatPeople } from "../src/gateway/telegram-project-bots/people.js";
import { resolveTelegramRecipient } from "../src/gateway/telegram-project-bots/members.js";
let db: Knex;
const botId = randomUUID();
const chat = { id: -100123, type: "supergroup" };
beforeEach(async () => {
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = ON");
  for (const table of ["users", "projects", "tasks"]) await db.schema.createTable(table, (t) => { t.text("id").primary(); });
  const require = createRequire(import.meta.url);
  for (const m of ["117_project_telegram_bots", "121_telegram_chat_mentions", "126_telegram_observed_senders", "127_telegram_recipient_tags"]) await require(`../migrations/pg/${m}.cjs`).up(db);
  await db("projects").insert({ id: "P-TEST" });
  await db("project_telegram_bots").insert({ id: botId, project_id: "P-TEST", telegram_bot_id: "123", username: "bot", token_enc: "test", filter_tags: "[]", poll_revision: randomUUID(), created_at: "2026-01-01", updated_at: "2026-01-01" });
  await db("project_telegram_chats").insert({ bot_id: botId, chat_id: String(chat.id), title: "Team", created_at: "2026-01-01" });
});
afterEach(async () => { await db.destroy(); });

describe("observed Telegram people", () => {
  it("collects senders, caption mentions, replies, forwards, service members, edits, rich mentions and membership updates", async () => {
    const user = (id: number) => ({ id, first_name: `User ${id}`, username: `person_${id}`, is_bot: false });
    await rememberChatPeople(db, botId, { message: { chat, from: user(1), caption: "@someone", caption_entities: [{ type: "mention", offset: 0, length: 8 }, { type: "text_mention", user: user(2) }],
      reply_to_message: { from: user(3) }, forward_origin: { sender_user: user(4) }, new_chat_members: [user(5)],
      rich_message: { blocks: [{ text: [{ type: "text_mention", user: user(6) }, { type: "mention", username: "rich_name" }] }] } } });
    await rememberChatPeople(db, botId, { edited_message: { chat, from: user(7), text: "edit" } });
    await rememberChatPeople(db, botId, { chat_member: { chat, from: user(8), new_chat_member: { user: user(9) } } });
    const keys = (await db("telegram_chat_mentions")).map((r) => r.mention_key).sort();
    expect(keys).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "username:rich_name", "username:someone"]);
  });
  it("does not collect private/unbound users, bots, anonymous chats or hidden forward names", async () => {
    for (const message of [{ chat: { id: 1, type: "private" }, from: { id: 1 } }, { chat: { id: -999, type: "group" }, from: { id: 2 } },
      { chat, from: { id: 3, is_bot: true }, sender_chat: { id: -777 }, forward_origin: { sender_user_name: "Hidden" } }]) await rememberChatPeople(db, botId, { message });
    expect(await db("telegram_chat_mentions")).toHaveLength(0);
  });
  it("keeps numeric mappings stable across username changes and refuses ambiguous username aliases", async () => {
    await db("users").insert({ id: "member" });
    await rememberChatPeople(db, botId, { message: { chat, from: { id: 22, username: "old_name" } } });
    await db("telegram_chat_mentions").update({ user_id: "member" });
    await rememberChatPeople(db, botId, { message: { chat, from: { id: 22, username: "new_name" } } });
    const rows = await db("telegram_chat_mentions"); const allowed = new Set(["owner", "member"]);
    expect(resolveTelegramRecipient("username:new_name", "new_name", rows, [], allowed, "owner")).toMatchObject({ userId: "member", resolution: "manual" });
    expect(resolveTelegramRecipient("username:new_name", "new_name", [...rows, { mention_key: "33", username: "new_name" }], [], allowed, "owner")).toMatchObject({ userId: "owner", resolution: "owner" });
  });
});
