# Development Workflow

qa-architect implements industry best practice: **"Fail fast locally, verify comprehensively remotely"**

## The Testing Pyramid

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRODUCTION                                         │
│                     Live domain deployment                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ Auto-deploy on main
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CI/CD (GitHub Actions)                    3-10 min  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ✅ Full test suite (all unit + integration)                        │   │
│  │  ✅ Security scans (npm audit, Gitleaks)                            │   │
│  │  ✅ Build verification                                               │   │
│  │  ⚠️  Matrix testing (Node 20+22) - Libraries only, use --matrix     │   │
│  │                                                                      │   │
│  │  ❌ Lint/format (pre-commit already did this)                       │   │
│  │  ❌ Type check (pre-push already did this)                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Smart skips: Draft PRs, docs-only changes                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ git push
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRE-PUSH HOOK                           < 30 sec  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ✅ Type check (tsc --noEmit) - catches type errors                 │   │
│  │  ✅ Tests on CHANGED FILES ONLY (vitest --changed)                  │   │
│  │                                                                      │   │
│  │  ❌ Lint/format (pre-commit already did this)                       │   │
│  │  ❌ Full test suite (CI will do this)                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ git commit
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRE-COMMIT HOOK                           < 5 sec  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ✅ ESLint --fix (staged files only)                                │   │
│  │  ✅ Prettier --write (staged files only)                            │   │
│  │  ✅ Stylelint --fix (CSS files only)                                │   │
│  │                                                                      │   │
│  │  ❌ Tests (too slow for commit)                                     │   │
│  │  ❌ Type check (too slow for commit)                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ git add
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEVELOPMENT                                        │
│                     Write code, write tests                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Principles

### 1. Each Layer Does Unique Work

| Layer          | Time Budget | Responsibility                  | What It Skips              |
| -------------- | ----------- | ------------------------------- | -------------------------- |
| **Pre-commit** | < 5 sec     | Lint + format staged files      | Tests, type check          |
| **Pre-push**   | < 30 sec    | Type check + changed-file tests | Lint (already done)        |
| **CI**         | 3-10 min    | Full suite + security           | Lint/format (already done) |

### 2. Delta Testing Locally

Pre-push only tests files you changed:

```bash
npm run test:changed  # vitest --changed HEAD~1
```

This keeps pre-push fast while still catching bugs before they hit CI.

### 3. No Redundant Work

- Pre-commit handles lint/format → CI doesn't repeat it
- Pre-push handles type check → CI doesn't repeat it
- Each layer adds NEW verification, not redundant checks

## Workflow Tiers

qa-architect offers three CI configurations based on your needs:

| Tier                  | Cost        | Matrix             | Security Scans | Best For                     |
| --------------------- | ----------- | ------------------ | -------------- | ---------------------------- |
| **Minimal** (default) | $0-5/mo     | Node 22 only       | Weekly         | Solo devs, side projects     |
| **Standard**          | $5-20/mo    | Node 20+22 on main | Weekly         | Small teams, client projects |
| **Comprehensive**     | $100-350/mo | Node 20+22 always  | Every commit   | High-compliance projects     |

### Matrix Testing

By default, qa-architect runs CI on Node 22 only. Use `--matrix` for libraries:

```bash
# Default: Single Node version (for apps you deploy)
npx create-qa-architect@latest

# With matrix: Node 20 + 22 (for published npm packages)
npx create-qa-architect@latest --matrix
```

**Who needs matrix testing?**

- ✅ npm libraries (published packages)
- ✅ CLI tools (users run various Node versions)
- ❌ Web apps (you control the production Node version)
- ❌ APIs/backends (you control the server)

## Available Scripts

After setup, these scripts are available:

```bash
# Development
npm run lint          # ESLint + Stylelint
npm run lint:fix      # Auto-fix issues
npm run format        # Prettier format all
npm run format:check  # Check formatting (CI)

# Testing
npm test              # Full test suite
npm run test:changed  # Tests on changed files (pre-push)
npm run test:watch    # TDD mode
npm run test:coverage # Coverage report

# Security
npm run security:audit   # npm audit
npm run security:secrets # Secrets scan

# Validation
npm run validate:pre-push # Pre-push checks
npm run validate:all      # Full validation
```

## Cost Optimization

### Avoid Duplicate Workflows

qa-architect's `quality.yml` is designed to be your **single CI workflow**. Don't use it alongside a separate `ci.yml`:

```bash
# Update and auto-clean duplicate workflow names
npx create-qa-architect@latest --update --workflow-minimal
```

### Analyze Your Costs (Pro)

```bash
npx create-qa-architect@latest --analyze-ci
```

Shows estimated GitHub Actions usage and optimization recommendations.
