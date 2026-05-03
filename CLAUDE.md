# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**npm**: `create-qa-architect` | **Version**: 5.13.5

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

### License Tiers

- **FREE**: Basic linting/formatting, 1 private repo, 50 runs/month
- **PRO**: Security scanning, Smart Test Strategy, unlimited
- Check tier: `hasFeature('smartTestStrategy')` or `getLicenseInfo()` in `lib/licensing.js`

### Workflow Tiers

Defaults to **minimal CI** to avoid unexpected GitHub Actions costs. Selectable via `--workflow-minimal/standard/comprehensive`. See `docs/CI-COST-ANALYSIS.md` and `tests/workflow-tiers.test.js`.

### Template-as-Product Contract

`quality.yml` is both qa-architect's own CI AND the template deployed to 15+ consumer repos. Key invariants:

- Never reference `node_modules/create-qa-architect` — consumers use `npx @latest`
- Never use `\s*` in YAML cleanup regexes — use `[ \t]*` (prevents line collapse)
- Conditional content uses section markers (`# {{NAME_BEGIN/END}}`) stripped by `stripSection()`
- `CONSUMER_FORBIDDEN_CONTENT` in `consumer-workflow-integration.test.js` gates consumer output
- Validate: `node tests/consumer-workflow-integration.test.js` | Deploy: `./scripts/deploy-consumers.sh --push`

## Key Files

- `setup.js:390-500` - Main entry, interactive mode handling
- `setup.js:985-2143` - Core setup flow (`runMainSetup`)
- `lib/licensing.js` - All tier logic, usage caps, feature gates
- `lib/project-maturity.js` - Maturity detection algorithm
- `config/defaults.js` - Default scripts, dependencies, lint-staged config

## Quality Gates

Coverage: 75% lines / 70% functions / 65% branches. Pre-commit: lint+format. Pre-push: tsc + test:patterns + test:commands + test:changed. Pre-release: `npm run prerelease`.

## Publishing

**Uses GitHub trusted publishing — do NOT run `npm publish` manually.** Push version bump to `main`; `release.yml` handles npm publish automatically (no OTP needed). After publishing, deploy consumers: `./scripts/deploy-consumers.sh --push`.

## Agent Workflow

Session start: read `docs/dev_guide/CONVENTIONS.md`. Planning: `/bs:plan <name>` → `docs/plans/`. Handoff: `/bs:context --save` / `--resume`.
