# Roadmap

> Strategic direction and planned features for QA Architect

## Development Philosophy

**AI-accelerated development**: Features are built in hours/days, not weeks/months. Traditional quarterly roadmaps don't apply when using Claude, Cursor, and AI coding tools.

- **Feature implementation**: 1-4 hours typical, 1-2 days for complex features
- **New language support**: 1 day per language
- **Integrations**: 2-4 hours each

**Business timelines may differ**: Customer acquisition, revenue ramp, and market penetration follow normal curves regardless of build speed.

## Current Version: 5.10.4

## Completed

- [x] ESLint 9 flat config support
- [x] Progressive quality (maturity detection)
- [x] Python toolchain support (Black, Ruff, mypy, pytest)
- [x] Smart Test Strategy (Pro) - risk-based pre-push validation
- [x] Monorepo support (Nx, Turborepo, Lerna, Rush, npm/pnpm/yarn workspaces)
- [x] Interactive mode with guided setup
- [x] Custom template support
- [x] License tier system (Free/Pro/Team/Enterprise)
- [x] Dependency monitoring (Dependabot integration)
- [x] Quality tools (v5.2.0) - Lighthouse CI, size-limit, axe-core, commitlint, coverage thresholds
- [x] Pre-launch validation (v5.3.0) - SEO, links, a11y, docs, env vars audit
- [x] Stripe payment flow for Pro tier purchases
- [x] Landing page at buildproven.ai/qa-architect

## In Progress (This Week)

(none currently)

## Ready to Build (When Prioritized)

**Language Support** (~1 day each):

- [ ] Rust support (Cargo, clippy, rustfmt)
- [ ] Go support (go mod, golangci-lint)
- [ ] Java support (Maven/Gradle integration)

**Tooling** (~2-4 hours each):

- [ ] VS Code extension
- [ ] Performance budgets (bundle size, Lighthouse, build time)

---

See [BACKLOG.md](BACKLOG.md) for tactical work items.
