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

| Layer          | Time Budget | Responsibility                         | What It Skips        |
| -------------- | ----------- | -------------------------------------- | -------------------- |
| **Pre-commit** | < 5 sec     | Lint + format staged files             | Tests                |
| **Pre-push**   | < 30 sec    | Secrets + changed dependency audit     | Tests                |
| **PR CI**      | < 5 min     | Mapped affected tests + security       | Unaffected tests     |
| **Audit**      | < 10 min    | Complete suite on schedule and release | No required coverage |

### 2. Focused Testing Locally

Run the test mapped to the code you changed. The revision-bound CI selector
checks the repository policy and runs the affected commands again:

```bash
npm run test -- tests/path/to/affected.test.js
```

Do not use `HEAD~1` as a change boundary. It misses earlier commits in a branch.

### 3. No Redundant Work

- Pre-commit handles lint/format → CI doesn't repeat it
- Pre-push handles secrets and changed dependency audits
- PR CI handles revision-bound affected tests and security
- Scheduled and release audits detect selector misses with the complete suite
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
npm test              # Complete audit suite
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

### Select affected tests (Pro)

```bash
# Inspect only. This command changes no file.
npx create-qa-architect@latest --test-impact-plan

# Write the repository policy.
npx create-qa-architect@latest --write-test-impact

# Update it while preserving reviewed mappings.
npx create-qa-architect@latest --update-test-impact
```

The generator detects declared Vitest, Jest, plain Node, and Pytest suites.
Source files without a sound dependency selector need repository-owned mappings.
Pass reviewed mappings with `--mapping-file <path>`. QA Architect does not
change CI for this feature. The shared `claude-kit` selector and the
`claude-setup` repository adapter own execution.
