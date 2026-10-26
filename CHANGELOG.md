# Changelog

## [Unreleased]

### Added

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

- OAuth state consumption rejects concurrent replay and separates GitLab
  states from existing providers. GitLab sign-in requires an existing linked,
  active account and does not register users or match accounts by email.
- Launching from GitLab now checks the configured issuer's account link even
  when a Marrow session already exists. Linking callbacks open Profile Account.
