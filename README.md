# QA Architect

Quality automation CLI for JavaScript/TypeScript, Python, and shell script projects. One command adds ESLint, Prettier, Husky, lint-staged, and GitHub Actions. **Pro adds release-confidence gates for AI-assisted teams: Ship Check, PR Risk Check, CI Doctor, and full-history secret scanning.**

**This repo = the free CLI.** For the Pro dashboard with repo analytics, CI integration, and automation workflows, see [QA Architect Pro](https://buildproven.ai/qa-architect) (included in BuildProven Starter Kit).

---

> **Maintainer & Ownership**
> This project is maintained by **BuildProven**, a studio focused on AI-assisted product development, micro-SaaS, and "vibe coding" workflows for solo founders and small teams.
> Learn more at **https://buildproven.ai**.

---

## Features

- **Prettier Code Formatting** - Consistent code style across your project
- **Husky Git Hooks** - Pre-commit (lint + format) and pre-push (type check + tests)
- **lint-staged Processing** - Only process staged files for speed
- **Delta Testing** - Pre-push runs tests on changed files only (fast feedback)
- **GitHub Actions** - Automated quality checks in CI/CD
- **TypeScript Smart** - Auto-detects and configures TypeScript projects
- **Python Support** - Complete Python toolchain with Black, Ruff, isort, mypy, pytest
- **Shell Script Support** - ShellCheck linting, syntax validation, permissions checks, best practices
- **Security Automation** - npm audit (Free), Gitleaks + ESLint security (Pro)
- **Progressive Quality** - Adaptive checks based on project maturity
- **Smart Test Strategy** - Risk-based pre-push validation (Pro feature)

### Release Confidence (Pro)

- **Ship Check** (`--ship-check`) - Unified SHIP/REVIEW/BLOCK verdict across lint, tests, security, coverage, bundle, Lighthouse, env vars, and CI cost. Markdown/JSON output for PR comments.
- **PR Risk Check** (`--pr-check --base main`) - Diff-aware risk classifier. Flags HIGH/MEDIUM/LOW per file, surfaces source changes missing tests, blocks high-risk PRs without coverage.
- **CI Doctor** (`--analyze-ci --doctor`) - Detects duplicated jobs, missing path filters, oversized matrices, and flaky workflows.
- **History Secrets Scan** (`--history-scan`) - Full git-history audit via gitleaks `--all`. Reports oldest exposures and secret-type counts.

### Quality Tools

- **Lighthouse CI** - Performance, accessibility, SEO audits (Free: basic, Pro: thresholds)
- **Bundle Size Limits** - Enforce bundle budgets with size-limit (Pro)
- **axe-core Accessibility** - WCAG compliance testing scaffolding (Free)
- **Conventional Commits** - commitlint with commit-msg hook (Free)
- **Coverage Thresholds** - Enforce code coverage minimums (Pro)

### Pre-Launch Validation

- **SEO Validation** - Sitemap, robots.txt, meta tags validation (Free)
- **Link Validation** - Broken link detection with linkinator (Free)
- **Accessibility Audit** - WCAG 2.1 AA compliance with pa11y-ci (Free)
- **Documentation Check** - README completeness, required sections (Free)
- **Env Vars Audit** - Validate .env.example against code usage (Pro)

## Target Users

- **Developers** who want quality automation without manual setup
- **Teams** standardizing code quality across multiple projects
- **Open source maintainers** enforcing contribution standards
- **Agencies** shipping consistent quality across client projects

## Demo / Live Links

```bash
# Try it on any project
npx create-qa-architect@latest
```

## Pricing

| Tier     | Price             | What You Get                                                                                                                                 |
| -------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free** | $0                | CLI tool, basic linting/formatting, npm audit (capped: 1 private repo, 50 runs/mo)                                                           |
| **Pro**  | $49/mo or $490/yr | **Release-confidence gates**: Ship Check, PR Risk Check, CI Doctor, full-history secret scan, Smart Test Strategy, multi-language, unlimited |

> **Pro included in [BuildProven Starter Kit](https://buildproven.ai/starter-kit)**

### Release Confidence by Tier

| Feature                              | Free | Pro+ |
| ------------------------------------ | ---- | ---- |
| Ship Check (release-readiness)       | ❌   | ✅   |
| PR Risk Check (diff classifier)      | ❌   | ✅   |
| CI Doctor (workflow waste detection) | ❌   | ✅   |
| Full-history secrets scan            | ❌   | ✅   |

### Security Features by Tier

| Feature                     | Free | Pro+ |
| --------------------------- | ---- | ---- |
| npm audit (basic)           | ✅   | ✅   |
| Gitleaks (secrets scanning) | ❌   | ✅   |
| ESLint security rules       | ❌   | ✅   |

### Quality Tools by Tier

| Feature                      | Free | Pro+ |
| ---------------------------- | ---- | ---- |
| Lighthouse CI (basic scores) | ✅   | ✅   |
| Lighthouse thresholds        | ❌   | ✅   |
| axe-core accessibility       | ✅   | ✅   |
| Conventional commits         | ✅   | ✅   |
| Bundle size limits           | ❌   | ✅   |
| Coverage thresholds          | ❌   | ✅   |

### Pre-Launch Validation by Tier

| Feature             | Free | Pro+ |
| ------------------- | ---- | ---- |
| SEO validation      | ✅   | ✅   |
| Link validation     | ✅   | ✅   |
| Accessibility audit | ✅   | ✅   |
| Documentation check | ✅   | ✅   |
| Env vars audit      | ❌   | ✅   |

### CI/CD Optimization by Tier

| Feature                      | Free | Pro+ |
| ---------------------------- | ---- | ---- |
| GitHub Actions cost analyzer | ❌   | ✅   |

### Get Pro

**Purchase:** [buildproven.ai/qa-architect](https://buildproven.ai/qa-architect)

After purchase, you'll receive a license key via email (QAA-XXXX-XXXX-XXXX-XXXX).

**Activate your license:**

```bash
npx create-qa-architect@latest --activate-license
# Enter your license key when prompted
```

**Check license status:**

```bash
npx create-qa-architect@latest --license-status
```

## Workflow Tiers (GitHub Actions Cost Optimization)

qa-architect follows industry best practice: **"Fail fast locally, verify comprehensively remotely"**

### The Testing Pyramid

| Layer          | Time     | What Runs                          | Why                        |
| -------------- | -------- | ---------------------------------- | -------------------------- |
| **Pre-commit** | < 5s     | Lint + format (staged files)       | Instant feedback           |
| **Pre-push**   | < 30s    | Type check + tests (changed files) | Catches bugs before push   |
| **CI**         | 3-10 min | Full test suite + security         | Comprehensive verification |

Note: CI does NOT re-run lint/format (pre-commit already did it). This avoids redundant work and reduces CI costs.

### Workflow Tiers (GitHub Actions Cost)

qa-architect defaults to **minimal CI** to avoid unexpected GitHub Actions bills. Choose the tier that matches your needs:

### Minimal (Default) - Budget-First (<1000 min/month target)

**Best for:** Solo developers, side projects, open source

- Single Node version (22) detection workflow
- CI defaults to detection-only (tests/security/docs disabled in minimal mode)
- Security scans run monthly (not on every commit)
- Path filters skip CI for docs/README changes
- **Runtime:** ~1-2 min/run
- **Est. usage target:** under ~1000 minutes/month by default

```bash
npx create-qa-architect@latest
# or explicitly:
npx create-qa-architect@latest --workflow-minimal
```

### Standard - $5-20/month

**Best for:** Small teams, client projects, production apps

- Single Node 22 testing **only on main branch**
- Security scans run monthly
- Path filters enabled
- **Runtime:** ~15-20 min/commit
- **Est. cost:** ~$5-20/mo for typical projects

```bash
npx create-qa-architect@latest --workflow-standard
```

### Comprehensive - $100-350/month

**Best for:** High-compliance projects, large teams

- Matrix testing (Node 20 + 22) on **every commit**
- Security scans inline (every commit)
- No path filters (runs on all changes)
- **Runtime:** ~50-100 min/commit
- **Est. cost:** ~$100-350/mo for typical projects

```bash
npx create-qa-architect@latest --workflow-comprehensive
```

### Matrix Testing for Libraries

**Publishing an npm package or CLI tool?** Use `--matrix` to test on multiple Node.js versions:

```bash
npx create-qa-architect@latest --matrix
```

This adds Node.js 20 + 22 matrix testing - recommended for published packages that support multiple runtime versions. Not needed for web apps you deploy (you control the Node version).

### Switching Between Tiers

Already using qa-architect? Convert to minimal to reduce costs:

```bash
npx create-qa-architect@latest --update --workflow-minimal
```

### ⚠️ Avoid Duplicate Workflows

**qa-architect's `quality.yml` is designed to be your single CI workflow.** Do not use it alongside a separate `ci.yml` - this causes:

- **2-3x CI minutes usage** (both workflows run on every push)
- **Duplicate checks** (ESLint, tests, security scans run twice)
- **Unexpected billing** (easily exceeds GitHub's 2,000 min/month free tier)

**If you have both `ci.yml` and `quality.yml`, run:**

```bash
npx create-qa-architect@latest --update --workflow-minimal
```

`--update` now automatically removes known duplicate workflow names (`ci.yml`, `test.yml`, `tests.yml`, `quality-legacy.yml`) while preserving `quality.yml`.

The `quality.yml` workflow is adaptive - it runs appropriate checks based on your project's maturity level, so a separate `ci.yml` is unnecessary.

### Analyzing Your Costs (Pro Feature)

```bash
npx create-qa-architect@latest --analyze-ci
```

Shows estimated GitHub Actions usage and provides optimization recommendations.

### License

**Commercial License (freemium)** — free tier covers the basic CLI; Pro features require a paid subscription. See [LICENSE](LICENSE).

## Tech Stack

| Component         | Technology                                         |
| ----------------- | -------------------------------------------------- |
| **Runtime**       | Node.js 20+                                        |
| **Linting**       | ESLint 9 (flat config)                             |
| **Formatting**    | Prettier 3                                         |
| **CSS Linting**   | Stylelint 16                                       |
| **Git Hooks**     | Husky 9 + lint-staged 15                           |
| **Python**        | Black, Ruff, mypy, pytest                          |
| **Shell Scripts** | ShellCheck, syntax validation, permissions checks  |
| **Performance**   | Lighthouse CI                                      |
| **Security**      | npm audit (Free), Gitleaks + ESLint security (Pro) |

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm 10+ (installed automatically with Node 20)
- Git repository (required for hooks)

### Quick Start

```bash
# Navigate to your project
cd your-project/

# Bootstrap quality automation
npx create-qa-architect@latest

# Install new dependencies
npm install

# Set up pre-commit hooks
npm run prepare
```

### Update Existing Setup

```bash
npx create-qa-architect@latest --update
npm install
npm run lint
```

`--update` refreshes the existing `quality.yml` from the latest template while preserving the detected workflow tier and existing matrix setting unless you explicitly override the tier with `--workflow-minimal`, `--workflow-standard`, or `--workflow-comprehensive`.

### Dependency Monitoring (Free)

```bash
npx create-qa-architect@latest --deps
```

### Pre-Launch Validation (Free)

```bash
npx create-qa-architect@latest --prelaunch
npm install
npm run validate:all
```

## Usage Examples

### Check Project Maturity

```bash
npx create-qa-architect@latest --check-maturity
```

**Output:**

```
Project Maturity Report

Maturity Level: Development
Description: Active development - has source files and tests

Quality Checks:
  Required: prettier, eslint, stylelint, tests
  Optional: security-audit
  Disabled: coverage, documentation
```

### Security Validation

```bash
# Check configuration security
npx create-qa-architect@latest --security-config

# Validate documentation
npx create-qa-architect@latest --validate-docs

# Comprehensive validation
npx create-qa-architect@latest --comprehensive
```

### GitHub Actions Cost Analysis (Pro)

```bash
# Analyze GitHub Actions usage and costs
npx create-qa-architect@latest --analyze-ci
```

**Output:**

```
📊 GitHub Actions Usage Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Repository: my-project

Estimated usage: 4,800 min/month
  Commit frequency: ~2.0 commits/day
  Workflows detected: 2

Workflow breakdown:
  ├─ ci.yml:
     • ~50 min/run
     • ~60 runs/month = 3000 min/month
  ├─ test.yml:
     • ~30 min/run
     • ~60 runs/month = 1800 min/month

💰 Cost Analysis
Free tier (2,000 min): ⚠️  EXCEEDED by 2,800 min
Overage cost: $22.40/month

Alternative options:
  Team plan ($4/user/month): Still exceeds (1,800 min overage)
    Total cost: $18.40/month
  Self-hosted runners: $0/min (but VPS costs ~$5-20/month)
```

### Custom Templates

```bash
# Use organization-specific standards
npx create-qa-architect@latest --template ./my-org-templates
```

## What Gets Added

```
your-project/
├── .github/
│   └── workflows/
│       └── quality.yml          # GitHub Actions workflow
├── .husky/                      # Pre-commit hooks
├── .editorconfig                # Editor defaults
├── .eslintignore                # ESLint ignore patterns
├── .lighthouserc.js             # Lighthouse CI config
├── .npmrc                       # npm configuration
├── .nvmrc                       # Node version pinning
├── .prettierrc                  # Prettier configuration
├── .stylelintrc.json            # Stylelint rules
├── eslint.config.cjs            # ESLint flat config
└── package.json                 # Updated scripts
```

## Available Scripts (After Setup)

```bash
npm run format              # Format all files
npm run format:check        # Check formatting (CI)
npm run lint                # ESLint + Stylelint
npm run lint:fix            # Auto-fix linting
npm run security:audit      # Vulnerability check
npm run security:secrets    # Scan for secrets
npm run validate:pre-push   # Pre-push validation
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features and strategic direction.

## Contributing

Want to improve this tool?

1. Fork the repository
2. Make your changes
3. Test with a sample project
4. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Pro Tier & Billing

### Purchasing Pro

Pro tier ($49/mo or $490/yr) includes:

- **Release-confidence gates**: Ship Check, PR Risk Check, CI Doctor, full-history secrets scan
- Security scanning (Gitleaks + ESLint security rules)
- Smart Test Strategy (risk-based pre-push validation)
- Multi-language support (Python, Shell scripts)
- Unlimited private repos and runs

Purchase at [buildproven.ai/qa-architect](https://buildproven.ai/qa-architect)

### Server-Side Setup (Maintainers Only)

The billing system uses Stripe webhooks to manage licenses. If you're deploying your own instance:

1. Set up webhook handler (see `webhook-handler.js`)
2. Configure Stripe live mode keys
3. Deploy to production server

See [docs/STRIPE-LIVE-MODE-DEPLOYMENT.md](docs/STRIPE-LIVE-MODE-DEPLOYMENT.md) for complete setup guide.

## Support

1. Review GitHub Actions logs
2. Open an issue in this repository

## License

Commercial freemium license — the base CLI is free to use; Pro features require a paid subscription. See [LICENSE](LICENSE) for details.

## Legal

- [Privacy Policy](https://buildproven.ai/privacy-policy)
- [Terms of Service](https://buildproven.ai/terms)

---

> **BuildProven** · [buildproven.ai](https://buildproven.ai)
