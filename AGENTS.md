# Repository Guidelines

## Project Overview

`create-qa-architect` is a CLI tool (npm: `create-qa-architect`) that bootstraps quality automation for JS/TS/Python/Shell projects. It generates ESLint, Prettier, Husky, lint-staged, and GitHub Actions configs. Pro tier adds security scanning, Smart Test Strategy, and multi-language support.

## Project Structure

```
setup.js                    # Main CLI entry — argument parsing, orchestration
├── lib/
│   ├── licensing.js        # Tier system (FREE/PRO), feature gating
│   ├── project-maturity.js # Detects project stage
│   ├── smart-strategy-generator.js  # Risk-based test selection (Pro)
│   ├── dependency-monitoring-*.js   # Dependabot config generation
│   ├── commands/           # Command handlers (validate, deps, analyze-ci)
│   ├── validation/         # Validators (security, docs, config)
│   ├── interactive/        # TTY prompt system
│   └── template-loader.js  # Custom template merging
├── templates/              # Config file templates
├── config/                 # Language-specific configs
└── tests/                  # 40+ test files
```

## Build, Test, and Development Commands

```bash
npm test                    # Run all tests (40+ test files)
npm run test:unit           # Fast unit tests only
npm run test:slow           # Integration tests
npm run test:coverage       # Coverage (75% lines / 70% functions required)
npm run lint                # ESLint + Stylelint
npm run format              # Prettier
npm run validate:all        # Full validation suite
npm run prerelease          # Required before publishing

# CLI testing
npx . --dry-run             # Test setup without changes
npx . --check-maturity      # Show project maturity detection
QAA_DEVELOPER=true node tests/setup.test.js  # Bypass license in tests
```

## Coding Style & Conventions

- JavaScript (Node.js) — no TypeScript
- Use `QAA_DEVELOPER=true` env var to bypass license checks during testing
- Tests use real filesystem operations with temp directories via `createTempGitRepo()`
- Never use `\s*` in YAML cleanup regexes — use `[ \t]*` (avoids cross-line collapse)
- `quality.yml` is both the project's own CI and the template deployed to 15+ consumer repos — treat every change as a multi-repo product deployment
- `CONSUMER_FORBIDDEN_CONTENT` in `consumer-workflow-integration.test.js` gates consumer output

## Key Rules

- Feature branch before any code changes — pre-commit hooks enforce this
- Publishing is automated via GitHub trusted publishing — never run `npm publish` manually
- Consumer deploy: `./scripts/deploy-consumers.sh --push` after publishing
- Workflow tier defaults to **minimal** to avoid unexpected CI costs
