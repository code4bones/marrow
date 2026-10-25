# Changelog

## [Unreleased]

### Added

- GitLab OIDC sign-in for the GitLab Applications launcher, with explicit
  account linking and unlinking in the private profile (English/Russian).
- Fixed-issuer discovery, S256 PKCE, nonce and ID-token verification,
  browser-bound single-use state, and identity ownership constraints.
- A dedicated English/Russian instruction screen for launches without a
  GitLab account link, with navigation to Marrow login or Profile Account.

### Changed

- OAuth state consumption rejects concurrent replay and separates GitLab
  states from existing providers. GitLab sign-in requires an existing linked,
  active account and does not register users or match accounts by email.
- Launching from GitLab now checks the configured issuer's account link even
  when a Marrow session already exists. Linking callbacks open Profile Account.
