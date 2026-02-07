# QA Architect - Backlog

**Last Updated**: 2026-02-07
**Scoring**: (Revenue + Retention + Differentiation) ÷ Effort = Priority Score

> See [ROADMAP.md](ROADMAP.md) for strategic direction and planned features.

---

## 🔥 High Value - Next Up

| ID  | Item                                          | Type    | Value Drivers      | Effort | Score | Status  |
| --- | --------------------------------------------- | ------- | ------------------ | ------ | ----- | ------- |
| F-1 | Generate pre-push hooks that mirror CI checks | Feature | Rev:3 Ret:4 Diff:3 | M      | 5.0   | Backlog |
| L-1 | Rust support                                  | Feature | Rev:3 Ret:4 Diff:4 | M      | 5.5   | Ready   |
| L-2 | Go support                                    | Feature | Rev:3 Ret:4 Diff:4 | M      | 5.5   | Ready   |
| L-3 | Java support (Maven/Gradle)                   | Feature | Rev:4 Ret:4 Diff:3 | M      | 5.5   | Ready   |
| T-1 | VS Code extension                             | Feature | Rev:4 Ret:5 Diff:3 | M      | 6.0   | Backlog |

| CI-2 | Fix postrail: crypto.test.ts tests taking 12.7s (investigate root cause, not timeout band-aid) | Bug | Rev:2 Ret:4 Diff:1 | S | 7.0 | Ready |

---

## 📊 Medium Value - Worth Doing

| ID  | Item | Type | Value Drivers | Effort | Score | Status |
| --- | ---- | ---- | ------------- | ------ | ----- | ------ |
| R-1 | Refactor workflow generation: replace regex stripping with conditional templating | Refactor | Rev:2 Ret:5 Diff:2 | M | 4.5 | Ready |
| R-2 | Add consumer workflow integration tests (generate + validate for each tier) | Tech Debt | Rev:2 Ret:5 Diff:2 | S | 6.0 | Ready |
| R-3 | Separate qa-architect-only content from consumer templates at source level | Refactor | Rev:2 Ret:4 Diff:2 | M | 4.0 | Ready |
| B-4 | Gitignore generated root files (.lighthouserc.js, QUALITY_TROUBLESHOOTING.md, eslint-security.config.js) | Bug | Rev:1 Ret:2 Diff:1 | XS | 4.0 | Ready |

---

## 📚 Low Value - When Needed

| ID  | Item | Type | Value Drivers | Effort | Score | Status |
| --- | ---- | ---- | ------------- | ------ | ----- | ------ |

---

## ✅ Completed

| ID   | Item                                                           | Type    | Completed  |
| ---- | -------------------------------------------------------------- | ------- | ---------- |
| -    | ESLint 9 flat config support                                   | Feature | 2026-01-XX |
| -    | Progressive quality (maturity detection)                       | Feature | 2026-01-XX |
| -    | Python toolchain support                                       | Feature | 2026-01-XX |
| -    | Smart Test Strategy (Pro)                                      | Feature | 2026-01-XX |
| -    | Monorepo support                                               | Feature | 2026-01-XX |
| -    | Interactive mode with guided setup                             | Feature | 2026-01-XX |
| -    | Custom template support                                        | Feature | 2026-01-XX |
| -    | License tier system                                            | Feature | 2026-01-XX |
| -    | Dependency monitoring                                          | Feature | 2026-01-XX |
| -    | Quality tools (Lighthouse CI, etc.)                            | Feature | v5.2.0     |
| -    | Pre-launch validation                                          | Feature | v5.3.0     |
| -    | Stripe payment flow                                            | Feature | 2025-12-XX |
| B-1  | Remove dev-only gitleaks test from consumer workflows          | Bug     | 2026-02-06 |
| B-3  | Fix gitleaks TOML template errors and overly broad base64 rule | Bug     | 2026-02-06 |
| T-2  | Configurable performance budgets via .qualityrc.json           | Feature | 2026-02-06 |
| CI-1 | Deploy hashFiles gitleaks fix to all vibebuildlab repos        | Bug     | 2026-02-06 |
| B-2  | Respect .qualityrc.json lighthouse.enabled setting             | Bug     | 2026-02-06 |
| CI-3 | Fix keyflash prettier formatting                               | Bug     | 2026-02-06 |
| CI-4 | Fix jobrecon prettier + .gitignore                             | Bug     | 2026-02-06 |
| CI-5 | Fix retireabroad @size-limit/file peer dep                     | Bug     | 2026-02-06 |
| CI-6 | Rollout qa-architect 5.12.0 to all 13 consumer projects        | Deploy  | 2026-02-06 |
| B-5  | Fix ai-second-act stray gitleaks binary reference in quality.yml | Bug     | 2026-02-07 |
| CI-7 | Remove pinned devDep + push all 6 consumer repos to 5.12.1     | Deploy  | 2026-02-07 |

---

## Checkpoints

Define milestones for `/bs:auto-dev --until checkpoint:<name>`:

- [ ] multi-language: L-1, L-2, L-3 (Rust, Go, Java support)
- [ ] tooling: T-1, T-2 (VS Code extension, performance budgets)
- [x] v5.10: Current stable release ✅

---

## Notes

- **Types:** Feature | Bug | Security | Perf | Docs | Refactor | Tech Debt
- **Status:** Ready | Backlog | In Progress | Blocked | Planned
- **Checkpoints:** Used by `/bs:auto-dev` for milestone-based stopping
- Re-evaluate as new language requests come in from users
