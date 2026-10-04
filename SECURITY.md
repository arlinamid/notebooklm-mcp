# Security policy

## Supported versions

Only the latest release of `@arlinamid/notebooklm-mcp` receives security fixes.
The original `notebooklm-mcp` package (≤ 2.0.0, archived upstream) is no
longer maintained.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's
[private vulnerability reporting](https://github.com/arlinamid/notebooklm-mcp/security/advisories/new).
Do not open a public issue.

Include:
- the affected version;
- your setup (OS, Node, MCP client, transport);
- reproduction steps;
- the impact you expect.

You can expect an acknowledgement within a week. Fixed issues are published as
GitHub security advisories.

## Scope

The server drives a real Chrome profile that is signed in to the user's Google
account. Reports are especially welcome for anything that could:

- expose or exfiltrate the browser profile, cookies or auth state;
- let content from notebooks or web pages act as instructions to the server
  (prompt injection that bypasses the approval prompts);
- read or write local files outside the allowed roots;
- run destructive actions (deletion, cleanup, re-auth) without the user's
  approval;
- let a remote client reach the Streamable-HTTP transport (it binds to
  127.0.0.1 by default).

Out of scope: Google changing or restricting the NotebookLM service, and
account limits imposed by Google.

## Releases

Releases are published from GitHub Actions with npm trusted publishing (OIDC),
so every version carries an npm provenance attestation linking it to the commit
and workflow that built it. Check it on the package page or with
`npm audit signatures`.
