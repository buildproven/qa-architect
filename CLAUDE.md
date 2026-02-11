# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**npm**: `create-qa-architect` | **Version**: 5.12.1

## Project Overview

QA Architect is a CLI tool (`create-qa-architect`) that bootstraps quality automation for JS/TS/Python/Shell script projects. One command adds ESLint, Prettier, Husky, lint-staged, and GitHub Actions. Pro tiers add security scanning (Gitleaks), Smart Test Strategy, and multi-language support.

## Commands

```bash
# Development
npm test                    # Run all tests (40+ test files)
npm run test:unit           # Fast unit tests only
npm run test:slow           # Integration tests (Python, monorepo, etc.)
npm run test:coverage       # Coverage report (75% lines, 70% functions required)
npm run lint                # ESLint + Stylelint
npm run format              # Prettier

# Run single test file
node tests/licensing.test.js
node tests/workflow-tiers.test.js
QAA_DEVELOPER=true node tests/setup.test.js

# Validation
npm run validate:all        # Full validation suite
npm run prerelease          # Required before publishing

# CLI testing
npx . --dry-run             # Test setup without changes
npx . --check-maturity      # Show project maturity detection
npx . --validate            # Run validation checks
npx . --workflow-minimal    # Test minimal CI setup (default)
npx . --workflow-standard   # Test standard CI setup
npx . --workflow-comprehensive  # Test comprehensive CI setup
npx . --analyze-ci          # Analyze GitHub Actions costs (Pro)
```

## Architecture

```
setup.js                    # Main CLI entry - argument parsing, orchestration
├── lib/
│   ├── licensing.js        # Tier system (FREE/PRO), feature gating
│   ├── project-maturity.js # Detects project stage (minimal→production-ready)
│   ├── smart-strategy-generator.js  # Risk-based test selection (Pro)
│   ├── dependency-monitoring-*.js   # Dependabot config generation
│   ├── commands/           # Command handlers (validate, deps, analyze-ci)
│   ├── validation/         # Validators (security, docs, config)
│   ├── interactive/        # TTY prompt system
│   └── template-loader.js  # Custom template merging
├── templates/              # Config file templates
├── config/                 # Language-specific configs (Python, Shell, etc.)
└── tests/                  # 40+ test files
```

### Data Flow

1. **Parse args** → `parseArguments()` handles CLI flags
2. **Route command** → validation-only, deps, license, or full setup
3. **Detect project** → TypeScript, Python, Shell scripts, Stylelint targets
4. **Load templates** → merge custom templates with defaults
5. **Generate configs** → ESLint, Prettier, Husky hooks, workflows
6. **Apply enhancements** → production quality fixes

### License Tier System

The tool uses a freemium model with feature gating in `lib/licensing.js`:

- **FREE**: Basic linting/formatting, 1 private repo, 50 runs/month
- **PRO**: Security scanning, Smart Test Strategy, unlimited

Check tier with `hasFeature('smartTestStrategy')` or `getLicenseInfo()`.

### Layered Testing Strategy (Best Practice)

qa-architect follows industry best practice: "Fail fast locally, verify comprehensively remotely"

| Layer          | Time     | What Runs                          | Files Modified                     |
| -------------- | -------- | ---------------------------------- | ---------------------------------- |
| **Pre-commit** | < 5s     | Lint + format (staged files)       | `config/defaults.js` (lint-staged) |
| **Pre-push**   | < 30s    | Type check + tests (changed files) | `setup.js` (hook generation)       |
| **CI**         | 3-10 min | Full test suite + security         | `.github/workflows/quality.yml`    |

Note: CI does NOT re-run lint/format (pre-commit already did it). This avoids redundant work.

### Workflow Tier System

qa-architect defaults to **minimal CI** to avoid unexpected GitHub Actions costs:

- **Minimal (default)**: Single Node 22, weekly security, path filters (~$0-5/mo)
- **Standard**: Single Node 22, tests on main only, weekly security, path filters (~$5-10/mo)
- **Comprehensive**: Matrix every commit, inline security (~$100-350/mo)
- **--matrix flag**: Enable Node 20+22 matrix (for library authors)

Implementation:

- `detectExistingWorkflowMode()` - Reads `# WORKFLOW_MODE:` marker or detects legacy
- `injectWorkflowMode()` - Applies mode-specific transformations
- `injectMatrix()` - Adds Node.js version matrix when `--matrix` flag is used

See `docs/CI-COST-ANALYSIS.md` for full analysis and `tests/workflow-tiers.test.js` for test patterns.

### Template-as-Product Contract

`quality.yml` is both qa-architect's own CI AND the template deployed to 15+ consumer repos. Every template change is a multi-repo product deployment.

Rules:

- Never reference `node_modules/create-qa-architect` — consumers use `npx @latest`, not a devDep
- Never use `\s*` in YAML cleanup regexes — `\s` matches `\n` and collapses lines. Use `[ \t]*`
- Conditional content uses section markers (`# {{NAME_BEGIN/END}}`) stripped by `stripSection()` in `workflow-config.js`
- `CONSUMER_FORBIDDEN_CONTENT` in `consumer-workflow-integration.test.js` gates what can appear in consumer output

Validation:

- `node tests/consumer-workflow-integration.test.js` — validates all 3 tiers
- `./scripts/deploy-consumers.sh` — auto-discovers and validates all local consumer repos
- `./scripts/deploy-consumers.sh --push` — regenerate + commit + push to all consumers

## Key Files

- `setup.js:390-500` - Main entry, interactive mode handling
- `setup.js:985-2143` - Core setup flow (`runMainSetup`)
- `lib/licensing.js` - All tier logic, usage caps, feature gates
- `lib/project-maturity.js` - Maturity detection algorithm
- `config/defaults.js` - Default scripts, dependencies, lint-staged config

## Testing Patterns

Tests use real filesystem operations with temp directories:

```javascript
const testDir = createTempGitRepo()
execSync('node setup.js --deps', { cwd: testDir })
assert(fs.existsSync(path.join(testDir, '.github/dependabot.yml')))
```

The `QAA_DEVELOPER=true` env var bypasses license checks during testing.

## Branching

Always create a feature branch before starting any code changes. Never commit directly to main.

```bash
git checkout -b feat/short-description   # before writing any code
```

PreToolUse hooks enforce this (block-commit-main.sh, block-push-main.sh), but branch proactively — don't wait for the hook to catch it.

## Quality Gates

- Coverage: 75% lines, 70% functions, 65% branches
- Pre-commit: lint + format (staged files via lint-staged)
- Pre-push: type check (tsc), test:patterns, test:commands, test:changed
- Pre-release: `npm run prerelease` (docs:check + all tests + e2e)

## Publishing

**This repo uses GitHub trusted publishing for npm** - DO NOT run `npm publish` manually.

Publishing workflow:

1. Run `npm run prerelease` to validate
2. Commit and push changes to `main`
3. GitHub Actions automatically publishes to npm via trusted publishing

No OTP/2FA codes needed. The `.github/workflows/release.yml` workflow handles publishing when:

- Version in `package.json` changes
- All tests pass
- Pushed to `main` branch

After publishing, deploy to consumer repos: `./scripts/deploy-consumers.sh --push`
