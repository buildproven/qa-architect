# Dev Guide — QA Architect

> Load at session start. Replaces blind codebase exploration.
> **Last updated:** 2026-03-08

## What This Project Does

QA Architect (`create-qa-architect`) is a CLI tool that bootstraps quality automation for JavaScript/TypeScript, Python, and shell script projects. One command installs ESLint, Prettier, Husky, lint-staged, and GitHub Actions. Pro tier adds Gitleaks security scanning, Smart Test Strategy, and multi-language support.

**Tech stack:** Node.js (CommonJS, no build step) · Vanilla JS (no framework) · GitHub Actions templates · c8 for coverage · Playwright for E2E

**Entry point:** `setup.js` — CLI argument parsing and orchestration. Run as `npx create-qa-architect` or `node setup.js`.

**npm package:** `create-qa-architect` v5.13.0 (published via GitHub trusted publishing)

## Directory Structure

```
qa-architect/
├── setup.js               # Main CLI entry — arg parsing + orchestration
├── lib/                   # Business logic modules
│   ├── licensing.js       # Freemium tier system (FREE/PRO), feature gates, usage caps
│   ├── project-maturity.js# Detects project maturity stage (minimal → production-ready)
│   ├── workflow-config.js  # CI workflow generation + tier transformations
│   ├── smart-strategy-generator.js  # Risk-based test selection (Pro feature)
│   ├── template-loader.js # Custom template merging
│   ├── commands/          # Command handlers (validate, deps, analyze-ci)
│   ├── validation/        # Validators (security, docs, config)
│   └── interactive/       # TTY prompt system
├── templates/             # Config file templates deployed to consumer repos
│   ├── ci/                # GitHub Actions workflow templates
│   └── scripts/           # Helper scripts deployed to consumers
├── config/                # Language-specific configs (Python, Shell)
├── scripts/               # Dev/ops scripts (deploy-consumers, e2e tests, etc.)
├── tests/                 # 40+ test files (Node's assert module, no test runner)
├── docs/                  # Dev guides and plans
│   ├── dev_guide/         # This file and other dev references
│   └── plans/             # Agent planning docs (/bs:plan output)
└── .claude/               # Claude Code workspace metadata
```

## Key Files

| File                                          | Role                                                        |
| --------------------------------------------- | ----------------------------------------------------------- |
| `setup.js:390-500`                            | Main entry — arg parsing, interactive mode, command routing |
| `setup.js:985-2143`                           | `runMainSetup()` — core setup flow                          |
| `lib/licensing.js`                            | All tier logic, usage caps, feature gates                   |
| `lib/project-maturity.js`                     | Maturity detection algorithm                                |
| `lib/workflow-config.js`                      | CI workflow generation, mode detection, matrix injection    |
| `lib/template-loader.js`                      | Custom template merging                                     |
| `config/defaults.js`                          | Default scripts, dependencies, lint-staged config           |
| `scripts/deploy-consumers.sh`                 | Auto-discovers + deploys to all consumer repos              |
| `tests/consumer-workflow-integration.test.js` | Gates what can appear in consumer CI output                 |

## Conventions

**Language:** Plain JavaScript (CommonJS). No TypeScript in the main source. `QAA_DEVELOPER=true` env var bypasses license checks in tests.

**Naming:** kebab-case files, camelCase functions/vars. Test files: `tests/[feature].test.js`.

**Feature addition pattern:**

1. Add feature gate check in `lib/licensing.js` if Pro-only
2. Implement in appropriate `lib/` module
3. Wire into `setup.js` argument parsing if it needs a CLI flag
4. Add test file: `tests/[feature].test.js` using Node `assert` module
5. Add to the `npm test` chain in `package.json`

**Template-as-Product contract** — `quality.yml` is BOTH qa-architect's own CI AND the template deployed to 15+ consumer repos. Rules:

- Never reference `node_modules/create-qa-architect` in templates — consumers use `npx @latest`
- Never use `\s*` in YAML cleanup regexes — use `[ \t]*` (avoids newline collapse)
- Conditional content uses `# {{NAME_BEGIN/END}}` section markers, stripped by `stripSection()`
- `CONSUMER_FORBIDDEN_CONTENT` in `consumer-workflow-integration.test.js` is a hard gate

**Workflow tiers:**

- Minimal (default): single Node 22, weekly security, path filters (~$0-5/mo)
- Standard: single Node 22, tests on main only (~$5-10/mo)
- Comprehensive: matrix every commit (~$100-350/mo)

**Testing approach:** Tests use real filesystem with temp directories (no mocks). `createTempGitRepo()` is the standard test setup helper.

**Publishing:** Never run `npm publish` manually. GitHub Actions handles publishing via trusted publishing when `package.json` version changes on `main`.

## Running the Project

```bash
# Install dependencies
npm install

# Run all tests (40+ files, ~2-3 min)
QAA_DEVELOPER=true npm test

# Fast unit tests only
npm run test:unit

# Single test file
QAA_DEVELOPER=true node tests/licensing.test.js

# CLI smoke test (dry run — no changes)
node setup.js --dry-run

# Validate before release
npm run prerelease

# Deploy to consumer repos (after publishing)
./scripts/deploy-consumers.sh           # validate only
./scripts/deploy-consumers.sh --push    # regenerate + commit + push
```

## Agent Gotchas

- **`QAA_DEVELOPER=true`** must be set for most tests — it bypasses license checks. Without it, tests fail with license errors.
- **Never `npm publish` manually** — GitHub trusted publishing only. Use `npm version patch/minor/major` + push tags.
- **Template changes affect 15+ consumer repos** — always run `tests/consumer-workflow-integration.test.js` after template edits.
- **`\s` in YAML regexes will collapse newlines** — use `[ \t]*` for any whitespace-trimming regex on YAML content.
- **Coverage thresholds:** 75% lines, 70% functions, 65% branches (enforced by `c8`).
- **No Vitest/Jest** — tests use Node's built-in `assert` module and are run directly with `node tests/*.test.js`.
- **Pre-push hook** runs `test:patterns`, `test:commands`, `test:changed` — these must all pass before push.
- **`.claude` directory** already exists (has prior workspace data) — do not overwrite its contents.

## Active Development Areas

From recent git log:

- Dependency updates (Dependabot active)
- CI cost optimization (minute budget guardrails, monthly vs weekly security scans)
- Staged rollout / canary deployment for consumer updates
- Vercel Blob integration for webhook handler (replacing filesystem storage)
- Documentation consistency improvements
