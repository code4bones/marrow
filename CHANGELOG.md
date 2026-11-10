# Changelog

## [Unreleased]

### Fixed

- Project slugs beginning with `P-` (case-insensitive) are rejected on create
  and rename, with agent guidance and database enforcement in PostgreSQL and
  SQLite. The creation form explains the distinction between slugs and IDs.

### Added

- `record.download_url` issues five-minute HTTP URLs for any accessible entity
  and its attached artifacts, including filename/MIME/size/hash/expiry and
  explicit agent download steps. GET needs no Authorization; entities export
  Markdown/JSON, artifact bytes are streamed unchanged.

### Added

- `artifact.download` retrieves real artifact bytes by ID/project-path through
  MCP: native raster images, embedded file resources, and explicit base64 for
  local saving, with membership checks, bounded size and SHA-256 verification.

### Fixed

- Telegram photo/document replies with configured work hashtags are classified as
  separate task candidates instead of being swallowed as attachments to an older
  task. Files and albums follow the new task even while its parent is pending.
- Message details now offer retry processing for rejected/failed classifications
  and historical tagged replies swallowed as attachments, preserving artifact
  bytes and preventing duplicate tasks.

- Telegram attachment HTTP response stream errors are contained even after a
  rejected status, preserving the bot/gateway lifecycle.

### Added

- Overview participant selector before Root, with per-project saved selection,
  responsible-assignee filtering for Timeline/Tree and a matching GraphQL graph
  filter applied before record limits.

- Independent task path/current performers alongside the stable responsible team;
  immutable actor/from/to/time/status history, cyclic handoffs for all tasks,
  paginated MCP history and detail-card route/transfer controls.
- MCP routing rules distinguish task.handoff from explicit responsible-team edits;
  normal Telly delivery and Telegram source feedback follow current performers.

- Artifact details preview images with zoom, video/audio with native controls and
  PDF alongside text/metadata; all formats retain a download action.
- Authenticated HEAD/inline file viewing, byte ranges for media seeking and UTF-8
  download filenames, preserving project membership checks and active-content restrictions.

- Manual task confirmation from Telegram message details with explicit assignees,
  optional title, AI bypass and the existing deduplicated task/Telly/reply pipeline.
- Telegram documents/media as task-linked Marrow artifacts, including albums and
  reply files, durable references/download retries, proxy and size bounds, file
  progress/retry UI and artifact IDs in task.get/preflight.

- Short tagged reports of current defects qualify as investigation tasks without
  requiring imperative wording; the classifier receives matched configured tags.

- Outgoing project-bot message registry prevents feedback loops through anonymous
  channel posts, channel-to-group forwards, edits, replays and other project bots;
  pre-send fingerprints fence updates arriving before the API response.

- Telegram tasks enter the existing Telly identity/route/acceptance pipeline for
  resolved performers, preserving owner fallback and shared task semantics.
- `clar` (CLAR / Уточнение) status with a mandatory question and source replies.
- Cyclic Telegram task stage handoffs through `task.handoff`, ordinary assignment
  change replies and final DONE replies via a durable integration outbox.
- Remembered Telegram participant references in task replies and /hash, with
  chat-local mappings and Telegram mentions instead of Marrow participant IDs.

- Telegram `/hash` group command and command menu, showing bot tags and their
  chat-specific assignees without a classifier call.

- Shared tasks with multiple assignees across MCP, GraphQL, task forms, lists,
  kanban, graphs, notifications, Telly offers and GitLab import/export.
- Telegram recipients collected from senders, mentions, replies, visible forwards,
  rich messages and group events; per-recipient routing tags from the bot filters.
- Tagged task requests without named recipients now fall back to the project owner.

- Per-chat Telegram mention mappings to project members, one task per message
  with owner fallback for multiple/unknown recipients, and Rich Message task replies.

- Telegram bot receive journals, per-bot pipeline counters/timestamps and
  message details with filter reasons, classification and task links.
- Rich Message replies confirming chat binding with the Marrow project title.
- Project Settings → Bots: multiple Telegram bots and key-bound chats,
  editable hashtag filters, and task extraction through the project owner's
  DeepSeek. Bots use grammY polling over the existing Telegram proxy, with
  live activity controls, isolated errors, durable retries and deduplication.
- GitLab OIDC sign-in for the GitLab Applications launcher, with explicit
  account linking and unlinking in the private profile (English/Russian).
- Fixed-issuer discovery, S256 PKCE, nonce and ID-token verification,
  browser-bound single-use state, and identity ownership constraints.
- A dedicated English/Russian instruction screen for launches without a
  GitLab account link, with navigation to Marrow login or Profile Account.

### Fixed

- Telegram polling now disposes request abort listeners after every grammY call,
  preventing MaxListenersExceededWarning on long-running bots.

### Changed

- Telegram task creation and lifecycle replies render only the task ID as inline
  code so it can be copied separately from the colon and title.

- Active project Developers can manage tasks, including completion, review
  decisions, priority, responsible-team assignment and deletion. Backend and
  web UI permissions match; membership and completion claim checks remain.

- Telegram recipients now show one person per known Telegram identity, sharing
  mappings and tags across sender/mention aliases; conflicting mappings require
  one explicit selection.
- Bot settings omit setup banners and source columns; message history shows five
  messages per page with dotted dates and 24-hour times.

- OAuth state consumption rejects concurrent replay and separates GitLab
  states from existing providers. GitLab sign-in requires an existing linked,
  active account and does not register users or match accounts by email.
- Launching from GitLab now checks the configured issuer's account link even
  when a Marrow session already exists. Linking callbacks open Profile Account.
