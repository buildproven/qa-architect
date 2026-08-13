# QA Architect

**Security audit and quality automation for AI-generated codebases. One command finds the vulnerabilities your vibe-coded app ships with.**

```bash
# Scan your project for security issues (free)
npx create-qa-architect@latest --audit
```

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  QA Architect — Vibe-Code Security Audit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🚨 BLOCKING FINDINGS DETECTED

  Total findings: 7
  🚨 Critical: 2
  ❌ High:     3
  ⚠️  Medium:   2

  🚨 CRITICAL (2)
  ─────────────────────────────────────────────────────
  pages/api/users.js:44
  Prisma query by ID from request params with no user ownership filter.
  → Fix: findUnique({ where: { id: params.id, userId: session.user.id } })

  lib/auth.js:12
  JWT signed without an expiry option — stolen token = permanent access.
  → Fix: jwt.sign(payload, secret, { expiresIn: '24h' })
```

QA Architect reports supported patterns and evidence boundaries. A clean scan is not proof that an application is vulnerability-free.

---

> **Maintainer & Ownership**
> This project is maintained by **BuildProven**, a studio focused on AI-assisted product development, micro-SaaS, and "vibe coding" workflows for solo founders and small teams.
> Learn more at **https://buildproven.ai**.

---

## What It Does

**Free tier — `--audit`:**

Runs [semgrep](https://semgrep.dev/) SAST, npm CVE audit, and direct production dependency provenance analysis against your codebase and produces a prioritized security report. Covers the most common vibe-coding vulnerability categories — including AI-native classes generic SAST misses, like secrets shipped in the client bundle and unscoped data access (IDOR) across Prisma, Drizzle, and Supabase:

| Category                                                                      | Coverage            |
| ----------------------------------------------------------------------------- | ------------------- |
| Secrets exposure (hardcoded keys, JWT without expiry)                         | ✅ Free             |
| Secrets in the client bundle (NEXT*PUBLIC*/VITE\_ secrets, service keys)      | ✅ Free             |
| Unscoped data access / IDOR (Prisma, Drizzle, Supabase query by request id)   | ✅ Free             |
| Auth & authorization gaps (missing checks, client-side auth)                  | ✅ Free             |
| Injection vectors (SQL injection, command injection, prototype pollution)     | ✅ Free             |
| Production misconfigs (CORS-all, verbose errors, debug mode, missing headers) | ✅ Free             |
| XSS patterns (unsafe HTML, dynamic hrefs)                                     | ✅ Free             |
| Dependency CVEs                                                               | ✅ Free (npm audit) |
| Direct production dependency source + npm registry evidence                   | ✅ Free             |
| Package-age and name-confusion review signals                                 | 🔒 Pro              |

**Pro tier — verified remediation:**

`--audit --fix` exports an inspectable, agent-neutral packet for each supported Critical/High Semgrep finding; nothing is sent to a provider. Dependency-CVE findings remain report-only. `--repair-with codex|claude --finding <id>` explicitly sends the selected packet and its redacted surrounding source context to that provider over stdin, then runs the adapter in a dedicated branch/worktree. Review the exported packet before invoking a provider. A repair is labeled `VERIFIED` only after the exact finding disappears, a regression-test delta is present when behavior is testable, focused tests pass, adjacent blocking findings do not increase, and evidence is bound to the resulting commit.

Pro also adds explicitly labeled, low-confidence package-age and name-confusion signals. Registry 404s remain registry facts—not claims that a package is malicious, hallucinated, or typo-squatting. The current policy flags packages first published within 30 days and names one insertion, deletion, substitution, or adjacent transposition from a versioned built-in protected-name list. JSON and SARIF output include the policy version, confidence, registry, lookup time, response state, and coverage limitations so automation can distinguish facts from heuristics.

**Also included:**

- **Shipping assurance** (`--ship-check`) — derives required checks from the exact change, workflow tier, stack/configuration, and QA Architect risk policy; emits a revision-bound PASS/BLOCK/INCOMPLETE manifest
- **Changed-code PR assurance** (`--pr-check`) — exact-head Semgrep gate with baselines, SARIF annotations, and revision-bound evidence
- **Web SaaS assurance pack** — detects Next.js, Supabase, Prisma, Drizzle, and Stripe; selects versioned deterministic/heuristic checks and names cache, RLS, and replay evidence that still requires runtime verification
- **Full-history secrets scan** (`--history-scan`) — gitleaks across entire git history
- **Quality bootstrap** — one command adds ESLint, Prettier, Husky, lint-staged, GitHub Actions

Create and independently verify assurance for an exact release candidate:

```bash
npx create-qa-architect@latest --ship-check \
  --base-sha <40-character-base-commit> \
  --head "$(git rev-parse HEAD)" \
  --json
```

Ship Check runs every risk-required check independently and binds its identity to
the base/head commits, binary diff, risk policy, relevant configuration, rule
pack, commands, results, and referenced PR/remediation evidence. A required
check that is skipped, unavailable, timed out, or stale yields `INCOMPLETE`.
Save the JSON output and verify it later from the candidate checkout with
`--ship-check --verify-ship-manifest <manifest.json>`.

Reproduce the required PR check locally against an exact revision:

```bash
npx create-qa-architect@latest --pr-check \
  --base-sha <40-character-base-commit> \
  --head "$(git rev-parse HEAD)" \
  --artifact-dir /tmp/qa-architect-assurance
```

Both assurance commands exit `0` only for `PASS`, `1` for `BLOCK`, and `2` for
`INCOMPLETE`. Optional checked-in `.qa-architect-pr-assurance.json` policy can
set the Semgrep timeout and project-relative path exclusions. Baselines,
waivers, blocking severities, and required checks remain in the separate
`.qa-architect-assurance.json` contract. Pro workflow generation adds a
least-privilege `pr-assurance` job; configure the repository secret
`QAA_LICENSE_JSON`, then require that check in branch protection.

The generated [assurance rule catalog](docs/ASSURANCE-RULE-CATALOG.md) states
the exact Web SaaS pack boundary, fixture-measured rules, safe patterns,
verification steps, and known false-positive/false-negative limitations. A
clean static scan is not a framework-security, tenant-isolation, or payments
certification.

Opt in to deployed-preview checks by passing an origin and a versioned config:

```json
{
  "schemaVersion": "1.0.0",
  "deployment": { "revisionHeader": "x-deployment-commit" },
  "publicPaths": ["/", "/health"],
  "privatePaths": [
    { "path": "/dashboard", "unauthenticatedStatuses": [401, 403, 404] }
  ],
  "debugPaths": ["/.env", "/__debug", "/_next/static/chunks/main.js.map"],
  "redirectProbePath": "/login?next=https://attacker.invalid",
  "errorProbePath": "/api/error-probe"
}
```

```bash
npx create-qa-architect@latest --ship-check \
  --base-sha <40-character-base-commit> \
  --head "$(git rev-parse HEAD)" \
  --preview-url https://my-branch.example.vercel.app \
  --preview-config .qa-architect-preview.json \
  --json
```

The strict `preview-assurance-v1` config declares public and private paths,
optional debug/redirect/error paths, and the response header that binds the
deployment to the expected commit. Missing revision metadata is reported as
`INCOMPLETE`, never as a verified pass. The read-only probes issue only `GET`
requests and check TLS, security headers, unexpected debug/source-map routes,
cross-origin redirects, error leakage, and expected public/private behavior.

An optional two-user authorization probe is state-changing. It runs only when
the config contains the exact `state-changing-preview-probe-v1` consent string
and the command also includes `--allow-preview-mutations`. Tokens are read from
the configured environment-variable names. The probe creates one synthetic
resource as user A, attempts the configured read and mutation as user B, and
then sends the configured cleanup request as user A for only the exact returned
resource ID. Authentication, network, and cleanup failures are `INCOMPLETE`.
Production-like hosts are refused unless both the config sets
`allowProduction: true` and the command includes
`--allow-production-preview`.

Evidence stores request method/origin/path/query-key names, status, safe header
names, timestamps, durations, byte counts, and body/identifier hashes. It does
not store authorization headers, tokens, request bodies, response bodies, PII,
raw resource IDs, or raw deployment IDs. This is bounded verification, not DAST
crawling, uptime monitoring, or permission for autonomous production testing.

## Quick Start

```bash
# 1. Install semgrep (required for --audit)
pip install semgrep          # or: brew install semgrep

# 2. Run security audit (free)
npx create-qa-architect@latest --audit

# 3. Write report to file (for docs or PR comments)
npx create-qa-architect@latest --audit --out audit-report.md

# 4. Export inspectable remediation packets (Pro; no provider transmission)
npx create-qa-architect@latest --audit --fix --remediation-out ./qaa-remediation

# 5. Explicitly repair one finding with a local adapter and verify the result
npx create-qa-architect@latest --audit --repair-with codex --finding <rule-id>
```

**Suppressing a false positive:** if a finding is a confirmed false positive (or
a true positive you've reviewed and accepted), add an inline `// nosemgrep`
comment on the offending line — the audit honors it and won't re-flag it:

```js
const mod = require(modulePath) // nosemgrep — path is hardcoded, not user input
```

This suppresses one line surgically instead of disabling the whole rule.

## Target Users

- **Vibe coders** about to charge real users — get confidence your app won't get hacked on launch day
- **AI-assisted builders** using Claude Code / Cursor daily — catch regressions before they ship
- **Inheritors** of AI-generated codebases — understand what's fragile before you touch it

## Demo / Live Links

```bash
# Try it on any project
npx create-qa-architect@latest
```

## Pricing

| Tier     | Price             | What You Get                                                                                                                                                                                                                     |
| -------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free** | $0                | Unlimited local security audit (`--audit`) and dependency evidence, plus linting/formatting and basic quality automation (1 private repo, 50 pre-push runs/mo)                                                                   |
| **Pro**  | $29/mo or $290/yr | **Everything in Free** + provider-neutral verified remediation, revision-bound PR-to-release assurance, advanced provenance signals, CI Doctor, full-history secret scan, evidence-backed test impact, multi-language, unlimited |

> **Pro included in [BuildProven Starter Kit](https://buildproven.ai/starter-kit)**

### Security Audit by Tier

| Feature                                             | Free | Pro |
| --------------------------------------------------- | ---- | --- |
| SAST (semgrep — auth, injection, XSS, misconfigs)   | ✅   | ✅  |
| npm CVE audit                                       | ✅   | ✅  |
| Gitleaks secret scanning (working tree)             | ✅   | ✅  |
| Full-history secret scan (`--history-scan`)         | ❌   | ✅  |
| ESLint security ruleset                             | ❌   | ✅  |
| Direct dependency registry/source evidence          | ✅   | ✅  |
| Package-age and name-confusion review signals       | ❌   | ✅  |
| Inspectable remediation packets                     | ❌   | ✅  |
| Codex/Claude isolated verified-remediation adapters | ❌   | ✅  |

### Release Confidence by Tier

Pro is the recurring merge-and-release workflow: it binds required checks,
findings, remediation evidence, and the exact candidate revision into a
verifiable PASS/BLOCK/INCOMPLETE result. The audit is the free acquisition
surface; Pro is the evidence and repair loop used on every meaningful change.

| Feature                              | Free | Pro |
| ------------------------------------ | ---- | --- |
| Ship Check (release-readiness)       | ❌   | ✅  |
| PR Risk Check (diff classifier)      | ❌   | ✅  |
| CI Doctor (workflow waste detection) | ❌   | ✅  |
| Evidence-backed affected tests       | ❌   | ✅  |
| Full-history secrets scan            | ❌   | ✅  |

### Quality Tools by Tier

| Feature                      | Free | Pro+ |
| ---------------------------- | ---- | ---- |
| Lighthouse CI (basic scores) | ✅   | ✅   |
| Lighthouse thresholds        | ❌   | ✅   |
| axe-core accessibility       | ✅   | ✅   |
| Conventional commits         | ✅   | ✅   |
| Bundle size limits           | ❌   | ✅   |
| Coverage thresholds          | ❌   | ✅   |

Coverage thresholds measure exercised code, not whether a test would fail when
behavior regresses. Comprehensive workflows also run a project-provided
`test:mutation` command when present; teams should use it for mutation or
behavioral-relevance checks rather than treating percentage coverage as proof.

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

### Generating affected-test policy (Pro feature)

Inspect the repository first. This command changes no file:

```bash
npx create-qa-architect@latest --test-impact-plan
```

Write the repository policy and canary workflow only with an immutable
`claude-kit` commit:

```bash
npx create-qa-architect@latest --write-test-impact --runtime-sha <40-character-commit>
```

The generator uses only declared test and install commands. Unknown impact
stops with a mapping request. It does not start the complete suite. Keep the
existing workflow during the canary. Change branch protection only after the
old and new gates have the same result contract.

### License

**Commercial License (freemium)** — free tier covers the basic CLI; Pro features require a paid subscription. See [LICENSE](LICENSE).

## Tech Stack

| Component         | Technology                                                                         |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Runtime**       | Node.js 20+                                                                        |
| **Linting**       | ESLint 9 (flat config)                                                             |
| **Formatting**    | Prettier 3                                                                         |
| **CSS Linting**   | Stylelint 16                                                                       |
| **Git Hooks**     | Husky 9 + lint-staged 15                                                           |
| **Python**        | Black, Ruff, mypy, pytest                                                          |
| **Shell Scripts** | ShellCheck, syntax validation, permissions checks                                  |
| **Performance**   | Lighthouse CI                                                                      |
| **Security**      | npm audit + Gitleaks secret scan (Free), full-history scan + ESLint security (Pro) |

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

See the [project roadmap](https://github.com/buildproven/qa-architect/blob/main/ROADMAP.md)
for planned features and strategic direction.

## Contributing

Want to improve this tool?

1. Fork the repository
2. Make your changes
3. Test with a sample project
4. Submit a pull request

See the [contribution guidelines](https://github.com/buildproven/qa-architect/blob/main/CONTRIBUTING.md).

## Pro Tier & Billing

The marketing/checkout page source lives in the
[repository landing-page directory](https://github.com/buildproven/qa-architect/tree/main/docs/landing).

### Purchasing Pro

Pro tier ($29/mo or $290/yr) includes:

- **Release-confidence gates**: Ship Check, PR Risk Check, CI Doctor, full-history secrets scan
- Security scanning (Gitleaks + ESLint security rules)
- Evidence-backed affected-test policy and canary workflow
- Evidence-backed affected-test policy and canary workflow generation
- Multi-language support (Python, Rust, Ruby, and Shell scripts)
- Unlimited private repos and runs

Purchase at [buildproven.ai/qa-architect](https://buildproven.ai/qa-architect)

### Server-Side Setup (Maintainers Only)

The billing system uses Polar.sh webhooks to manage licenses. If you're deploying your own instance:

1. Set up webhook handler (see `webhook-handler.js`)
2. Configure Polar.sh products and webhook secret
3. Deploy to production server (Vercel)

See the [Polar deployment guide](https://github.com/buildproven/qa-architect/blob/main/docs/POLAR-DEPLOYMENT.md)
for the complete setup guide.

## Support

For Pro licensing, billing, or activation help, email
[support@buildproven.ai](mailto:support@buildproven.ai). We aim to respond within
24–48 hours. For reproducible product defects, include the CLI output and open
an issue in this repository.

## License

Source code is licensed under **Apache-2.0** (see [LICENSE](LICENSE)). Use of paid **Pro features** at runtime is additionally governed by the commercial terms in [COMMERCIAL.md](COMMERCIAL.md). The base CLI is free to use; Pro features require a paid subscription.

## Legal

- [Privacy Policy](https://buildproven.ai/privacy-policy)
- [Terms of Service](https://buildproven.ai/terms)

---

> **BuildProven** · [buildproven.ai](https://buildproven.ai)
