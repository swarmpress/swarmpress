# swarm.press Documentation

> **Last Updated:** 2026-05-12
> **Status:** Autonomous chain proven end-to-end against the live cinqueterre.travel site

Welcome to the swarm.press documentation. swarm.press is a fully autonomous virtual publishing house operated by intelligent agents with human oversight.

**Live proof (2026-05-12):** A brief inserted into Postgres became
[https://cinqueterre.travel/en/blog/last-light-on-sentiero-azzurro/](https://cinqueterre.travel/en/blog/last-light-on-sentiero-azzurro/) —
WriterAgent (Isabella) drafted the editorial, EditorAgent (Marco) judged
quality_score=7 and approved, RepoClient merged the PR, GitHub Actions
deployed. The only human action was writing the brief. See the
[Architecture Overview](./architecture/overview.md) for the full chain.

**Recent architectural shifts:**
- **Repo-canonical content storage** — page bodies and collection items
  live in the site's GitHub repo, not in Postgres. Postgres holds
  operational metadata (tasks, schedules, audit log, outbox).
- **Routable draft path** — WriterAgent commits drafts at their real URL
  path (`content/pages/blog/{slug}.json`); the PR branch
  (`drafts/content-{id}`) is the staging mechanism, not a path prefix.
- **Build & deploy owned by the site repo** — each site has its own
  `.github/workflows/deploy.yml`; the platform never builds Astro locally
  or pushes to gh-pages.

---

## Quick Start

| Need | Go To |
|------|-------|
| Set up development environment | [Installation Guide](./getting-started/installation.md) |
| Get running in 5 minutes | [Quickstart](./getting-started/quickstart.md) |
| Deploy to production | [Deployment Guide](./guides/deployment.md) |
| Understand the architecture | [Architecture Overview](./architecture/overview.md) |
| API reference | [API Documentation](./reference/api.md) |

---

## Documentation Structure

### Getting Started
- [Installation](./getting-started/installation.md) - Development environment setup
- [Quickstart](./getting-started/quickstart.md) - 5-minute getting started guide

### Guides
- [Deployment](./guides/deployment.md) - Production deployment options
- [GitHub OAuth](./guides/github-oauth.md) - Authentication setup
- [User Guide](./guides/user-guide.md) - Admin dashboard usage
- [Theme Development](./guides/theme-development.md) - Creating themes with content submodules

### Architecture
- [Overview](./architecture/overview.md) - High-level system architecture
- [Content Architecture](./architecture/content-architecture.md) - Metadata vs content separation, JSON blocks
- [Multi-Tenant](./architecture/multi-tenant.md) - Tenant hierarchy and isolation
- [Editorial Planning](./architecture/editorial-planning.md) - Content workflow system
- [Sitemap System](./architecture/sitemap-system.md) - Agentic sitemap management
- [GitHub Integration](./architecture/github-integration.md) - GitHub collaboration features

### Reference
- [API](./reference/api.md) - Complete tRPC API documentation

---

## Related Resources

| Resource | Description |
|----------|-------------|
| [Specifications](/specs/) | Authoritative design documents |
| [CLAUDE.md](/CLAUDE.md) | Development guidelines and architecture decisions |
| [Cinque Terre Theme](https://github.com/...) | Reference implementation theme |
| [Content Submodule](../cinqueterre.travel/) | Example content repository structure |
| [Archive](./archive/) | Historical documentation |

---

## Documentation Standards

### Frontmatter
Every documentation file should include:
```yaml
---
title: "Document Title"
description: "Brief description"
lastUpdated: YYYY-MM-DD
status: current | draft | deprecated
---
```

### Keeping Docs Current
- Update docs when behavior changes
- Archive superseded planning docs
- Add "Last Updated" date to modifications

---

## Contributing

When updating documentation:
1. Update the relevant docs in the same PR as code changes
2. Ensure API.md reflects any endpoint changes
3. Archive planning docs when features are complete
4. Run `pnpm docs:validate` before committing
