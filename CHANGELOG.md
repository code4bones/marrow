# Changelog

## [Unreleased]

### Added

- GitLab OIDC sign-in for the GitLab Applications launcher, with explicit
  account linking and unlinking in the private profile (English/Russian).
- Fixed-issuer discovery, S256 PKCE, nonce and ID-token verification,
  browser-bound single-use state, and identity ownership constraints.

### Changed

- OAuth state consumption rejects concurrent replay and separates GitLab
  states from existing providers. GitLab sign-in requires an existing linked,
  active account and does not register users or match accounts by email.
