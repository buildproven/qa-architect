# QA Architect - Backlog

**Last Updated**: 2026-02-06
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

| CI-2 | Fix CI: postrail — tests exceed 5-min budget (optimize slow tests or raise budget) | Bug | Rev:2 Ret:4 Diff:1 | S | 7.0 | Ready |
| CI-3 | Fix CI: keyflash — run `prettier --write .` (2 files), fix README .env.local ref | Bug | Rev:2 Ret:4 Diff:1 | S | 7.0 | Ready |
| CI-4 | Fix CI: jobrecon — run `prettier --write .` (7 files), add `*.log` to .gitignore, fix/suppress ESLint security false positives | Bug | Rev:2 Ret:4 Diff:1 | S | 7.0 | Ready |
| CI-5 | Fix CI: retireabroad — fix `@size-limit/file` peer dep conflict in package.json | Bug | Rev:2 Ret:4 Diff:1 | S | 7.0 | Ready |

---

## 📊 Medium Value - Worth Doing

| ID  | Item | Type | Value Drivers | Effort | Score | Status |
| --- | ---- | ---- | ------------- | ------ | ----- | ------ |

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
