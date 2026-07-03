# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Instead, report privately via
[GitHub's private vulnerability reporting](https://github.com/amitray007/silo/security/advisories/new)
(Security → Report a vulnerability). If that is unavailable, contact the
maintainer directly.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (a proof of concept if possible)
- Affected version / commit

You'll get an acknowledgement as soon as possible, and updates as the issue is
investigated and resolved. Please give a reasonable window to address the issue
before any public disclosure.

## Scope

silo is a single-user, self-hosted store with no third-party network calls per
its privacy design. Security-relevant areas include: metadata/full-text
extraction (fetching arbitrary URLs), the MCP surface, and any future capture
extension. Reports touching these are especially welcome.
