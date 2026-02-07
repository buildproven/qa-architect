# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.12.0] - 2026-02-07

### Fixed

- **B-1: Remove dev-only gitleaks test from consumer workflows**: Template now strips gitleaks binary cache and verification steps in minimal mode. Consumer repos no longer reference `tests/gitleaks-real-binary-test.js` which only exists in qa-architect itself.
- **B-3: Fix gitleaks TOML template errors**: Removed overly broad base64-secret rule that caused false positives on 40+ char alphanumeric strings. Fixed invalid `[[rules.allowlist]]` nesting with proper `[allowlist]` section. Added artifact path exclusions.
- **Maturity detection edge case**: Projects with <3 source files but with test files were incorrectly classified as 'minimal' instead of 'bootstrap'. Fixed threshold logic ordering.

### Added

- **Multi-package-manager pre-push audit**: Pre-push hook now detects pnpm/yarn/npm and uses the appropriate audit command
- **Smart test strategy optimization**: HIGH RISK pre-push now runs `test:medium`/`test:fast` instead of `test:comprehensive`, excluding E2E and command tests (CI only)
- **`test:changed` script**: New script for running tests on recently changed files via vitest
- **Smart Strategy Generator tests**: 18 dedicated tests covering all 6 project types, detection priority, custom overrides, and risk patterns
- **Maturity boundary tests**: 17 edge case tests for threshold boundaries, malformed inputs, and GitHub Actions output format

### Changed

- **Workflow tier system**: Minimal mode now strips maturity detection steps from consumer CI for faster runs
- **CI-6 rollout**: Updated 7 consumer projects to 5.12.0 workflow configuration

## [5.11.3] - 2026-02-03

### Fixed

- **Auto-install commitlint dependencies**: Commitlint dependencies now automatically added to package.json
  - Added `commitlint`, `@commitlint/cli`, `@commitlint/config-conventional` to baseDevDependencies
  - Updated commitlint versions from ^19.0.0 to ^20.4.1
  - Fixes issue where commit-msg hook would fail because dependencies weren't installed
  - Previously, commitlint hook was created but dependencies were only added if quality tools were enabled
  - Now all projects get commitlint dependencies automatically during setup

## [5.11.2] - 2026-02-03

### Fixed

- **GitHub Actions Cost Reduction (~50%)**: Skip Quality Checks for Dependabot PRs
  - Added `if: github.actor != 'dependabot[bot]'` condition to detect-maturity job
  - Dependabot PRs auto-merge based on their own checks, no need for duplicate CI
  - Reduces workflow runs by ~50% on repos with active Dependabot
- **Updated CI Cost Analysis**: Replaced inaccurate estimates with actual January data
  - Old doc claimed 77,000 mins/month (was 100x off)
  - Actual usage: ~2,400 mins/month
  - Main cost driver identified: Dependabot PR spam (56% of all runs)

## [5.11.1] - 2026-01-31

### Fixed

- **Husky v9/v10 Compatibility**: Removed deprecated `husky.sh` references from all generated hooks
  - Removed `#!/bin/sh` + `. husky.sh` source lines from generated pre-commit and pre-push hooks
  - Fixes deprecation warnings in Husky v9 and prevents breakage in v10
  - Affects `setup.js` and `lib/smart-strategy-generator.js`
- **Security**: Fixed high-severity `tar` vulnerability (bumped to 7.5.7)

## [5.11.0] - 2026-01-27

### Changed

- **Layered Testing Strategy**: Implemented industry best practice "fail fast locally, verify comprehensively remotely"
  - Pre-commit: lint + format staged files (<5s)
  - Pre-push: type check + tests on changed files (<30s)
  - CI: full test suite + security (3-10 min)
  - CI no longer re-runs lint/format (pre-commit already did it)
- **Simplified Tier System**: Removed Team/Enterprise tiers (FREE + PRO only)

### Fixed

- Removed lighthouse from CLI project (web-app-only tool)
- Disabled false-positive security ESLint rules for CLI context
- Resolved all 23 ESLint no-unused-vars errors
- Updated gitleaks config for v8 compatibility
- Fixed test coverage threshold failure

## [5.10.4] - 2026-01-21

### Fixed

- **Workflow Dependency Installation**: Fixed maturity detection step to install dependencies first
  - Added "Install dependencies for maturity detection" step before "Detect Project Maturity"
  - Fixes workflow failure when `node_modules/create-qa-architect/lib/project-maturity.js` is accessed before dependencies are installed
  - Affects projects without local `lib/project-maturity.js` (all projects except qa-architect itself)
  - Test added to verify dependency installation order
- **Workflow Package Manager Support**: Added pnpm and bun setup steps to all workflow jobs
  - GitHub Actions runners only have npm and yarn 1.x pre-installed (pnpm and bun are missing)
  - Added conditional "Setup pnpm" step (version 8.15.0) to all 6 jobs when pnpm is detected
  - Added conditional "Setup Bun" step (version 1.0.0) to all 6 jobs when bun is detected
  - Jobs: detect-maturity, core-checks, linting, security, tests, documentation
  - Fixes "pnpm: command not found" and "bun: command not found" errors in workflows
  - Test updated to verify all jobs have both pnpm and bun setup with correct version formats

## [5.10.3] - 2026-01-19

### Fixed

- **Gitleaks Config TOML Syntax**: Fixed mixed allowlist syntax causing workflow failures
  - Changed from mixed `[[rules.allowlist]]` and `[allowlist]` to consistent `[[allowlist]]`
  - Fixes "AllowList expected a map, got slice" error that blocked GitHub Actions release workflow
  - Release workflow will now properly publish npm packages automatically

## [5.10.2] - 2026-01-19

### Fixed

- **Package Manager Detection**: Auto-detect pnpm/yarn/npm for security audit commands
  - Pre-push hook now detects lock file and uses correct audit command
  - `security:audit` and `security:audit:fix` scripts now work with pnpm/yarn projects
  - Fixes vibebuildlab pre-push hook regression from v5.10.1 --update
  - Detection order: pnpm-lock.yaml → yarn.lock → npm (default)

## [5.10.1] - 2026-01-19

### Fixed

- **Workflow Mode Injection**: Fixed `injectWorkflowMode` to properly update existing WORKFLOW_MODE markers
  - Standard mode now correctly adds main branch condition to tests job
  - Comprehensive mode now correctly removes path filters and schedule triggers
  - Fixes workflow-tiers test failure that blocked v5.10.0 npm publish

## [5.10.0] - 2026-01-19

### Added

- **Development Workflow Documentation**: Added comprehensive `docs/DEVELOPMENT-WORKFLOW.md` explaining all stages from local dev to production
- **Turborepo Support**: Added automatic Turborepo detection and integration in CI workflows
  - Detects `turbo.json` and sets `is-turborepo` flag
  - Adds `turbo-prefix` output for running tasks with `turbo run`
  - Full documentation in `docs/TURBOREPO-SUPPORT.md`
- **Security Configuration**: Added gitleaks configuration for secrets scanning
- **Troubleshooting Documentation**: Added comprehensive quality troubleshooting guides and Stripe environment setup
- **Test Infrastructure**: Added accessibility, E2E, and placeholder test files with proper TypeScript configuration

### Changed

- **CI-Aware Husky**: Updated `prepare` script to automatically skip Husky in CI environments
  - No more manual `HUSKY=0` env var needed
  - Works in Vercel, GitHub Actions, and all CI platforms
  - Applied to both `package.json` and `config/defaults.js` (template)
- **Quality Workflow**: Updated GitHub Actions quality workflow and pre-push hooks
- **Smart Test Strategy**: Enhanced test strategy script for better risk assessment
- **Lint Configuration**: Fixed lint-staged TypeScript configuration to avoid project conflicts

### Fixed

- **E2E Tests in Pre-push**: Fixed template divergence causing E2E tests to run in pre-push hooks
  - Updated `templates/scripts/smart-test-strategy.sh` to exclude E2E tests
  - Updated `lib/smart-strategy-generator.js` for all project types (cli, webapp, saas, api)
  - E2E tests now only run in CI with proper infrastructure (dev server, browsers)
  - Pre-push hooks now complete in < 2 minutes (was hanging for 5-10 minutes)
  - Fixes: postrail, brettstark-about, and other web app projects
- **Test Error Handling**: Fixed undefined stdout/stderr handling in deps-edge-cases test

## [5.9.1] - 2026-01-17

### Fixed

- **Workflow Path Resolution**: Fixed quality.yml template to support both local and node_modules file paths
  - Workflow now checks for files locally first (for qa-architect itself), then falls back to `node_modules/create-qa-architect/` (for projects using the tool)
  - Fixes workflow failures in projects where `lib/project-maturity.js`, `setup.js`, and `scripts/check-docs.sh` were missing
  - Affected workflow steps: detect-maturity, security checks, documentation validation
  - No changes needed for existing projects - workflows will automatically work correctly

## [5.9.0] - 2026-01-16

### Changed

- **Licensing Simplification**: Removed TEAM and ENTERPRISE tiers
  - Simplified to FREE + PRO two-tier model (TEAM/ENTERPRISE were marked "coming soon" but never implemented)
  - Removed 244 lines of unused code (RBAC, SSO, SAML, Slack integration, multi-repo dashboard, audit logging)
  - No impact on existing FREE/PRO users
  - Updated: lib/licensing.js (tiers, features, upgrade messages), webhook-handler.js (Stripe prices), admin-license.js
  - Updated tests: removed TEAM/ENTERPRISE test cases, fixed security tampering tests
  - Updated documentation: README.md, CLAUDE.md, docs/, .serena/memories
  - Result: Clean two-tier architecture with no unimplemented features

## [5.8.0] - 2026-01-14

### Fixed

- **Lighthouse CI Failures**: Lighthouse failures now explicitly fail builds for production-ready projects
  - Added failure reporting step that logs errors and adds job summary
  - Production-ready projects must pass Lighthouse checks (hard gate)
  - Other maturity levels show warnings but don't block (soft failure)
  - Prevents performance regressions, accessibility issues, and SEO problems from merging silently

- **Job Summary Accuracy**: Quality check summary now shows actual pass/fail results instead of just "enabled"
  - Uses `needs.<job>.result` to check actual job outcomes
  - Shows ✅ for success, ❌ for failure, ⏭️ for skipped, ⚠️ for cancelled
  - Prevents misleading "all green" summaries when checks actually failed

### Changed

- **ESLint Configuration**: Fixed unsafe regex warnings in workflow-config.js with proper disable comments

## [5.7.0] - 2026-01-13

### Added

- **Enhanced Pre-Push Security**: Security scans now run in local pre-push hooks
  - Secret scanning with gitleaks (prevents commits with secrets)
  - Dependency audit with npm audit (catches vulnerabilities early)
  - XSS pattern detection (innerHTML and eval with interpolation)
  - Saves ~200 GitHub Actions minutes/month by moving security local

### Changed

- **Minimal CI Workflow**: Drastically simplified GitHub Actions workflow (443 → 90 lines)
  - Removed redundant linting/formatting checks (now in pre-push hook)
  - Removed Stylelint from CI (redundant with local checks)
  - Main branch only triggers (feature branches use local hooks)
  - Keeps: Full test suite + build verification + weekly security scan
  - Expected savings: 60-85% reduction in CI minutes usage
- **Workflow Mode Marker**: Added `# WORKFLOW_MODE: minimal` marker to quality.yml
  - Makes it easy to detect which tier is active
  - Preserves placeholder system for mode switching

### Fixed

- **CI Cost Efficiency**: Addresses GitHub Actions usage exceeding free tier limits
  - Before: ~7,260 min/month across multiple repos
  - After: ~700-1,000 min/month (85-90% reduction)
  - Strategy: Move validation to local pre-push, keep CI as safety net

## [5.6.1] - 2026-01-09

### Added

- **Concurrency Controls**: Workflow now cancels in-progress runs when new commits are pushed, saving CI minutes
- **Documentation**: Added warning about avoiding duplicate workflows (ci.yml + quality.yml) which can cause 2-3x CI usage

## [5.6.0] - 2026-01-08

### Added

- **Command Modules**: 6 new modular command handlers
  - `lib/commands/dry-run.js` - Dry run mode implementation
  - `lib/commands/interactive-handler.js` - Interactive mode handling
  - `lib/commands/license-commands.js` - License management
  - `lib/commands/maturity-check.js` - Project maturity detection
  - `lib/commands/prelaunch-setup.js` - Pre-launch validation
  - `lib/commands/workflow-config.js` - Workflow configuration
- **Lazy Loading**: Infrastructure for performance optimization (`lib/lazy-loader.js`)
- **Submodule Updates**: Automatic submodule update notifications via GitHub Actions
  - Weekly checks for outdated submodules (every Monday at 9am UTC)
  - Automatically creates PRs with updates when found
  - One-click merge to keep submodules current
- **Serena Integration**: MCP server configuration for AI-assisted development
  - Project memories for architecture, conventions, and suggested commands
  - Task completion checklists and project overview
- **Documentation**: 7 comprehensive new documentation files
  - Architecture review and improvement roadmap
  - Performance audit, summary, and quickstart guide
  - Lazy loading implementation guide

### Fixed

- **Silent Failures**: Fixed 18 critical silent failure issues
  - File I/O error handling improvements
  - Telemetry error visibility
  - Error reporter error handling
  - Config parsing failures
- **Type Safety**: Resolved 36 TypeScript errors
  - Proper discriminated unions
  - JSDoc annotations on all public functions
  - Eliminated type errors across codebase
- **CI/CD**: Corrected .gitleaksignore line numbers for security-licensing.test.js
  - Updated entries to match actual test file line numbers
  - Prevents false positive secret detections in CI
  - Added missing test license keys to ignore list
- **Workflow Generation**: Fixed duplicate YAML key issues in tier generation

### Changed

- **Quality Standard**: Achieved 98% production-perfect quality through autonomous quality loop
  - Security: Grade A+ (OWASP Top 10 PASS, 0 critical/high vulnerabilities)
  - Architecture: 88/100 (production-ready, zero circular dependencies)
  - Performance: Grade A (73ms startup, 193KB gzipped, <30s tests)
  - Code Quality: 0 ESLint errors/warnings
- **Code Organization**: Reduced setup.js complexity by 351 lines through module extraction
- **Dependencies**: Updated .claude-setup submodule to v4.0.0
  - Automatic submodule update notifications
  - Command cleanup and documentation improvements
- **Test Coverage**: Improved to 76% with comprehensive test suite (40+ test files passing)

## [5.4.3] - 2026-01-08

### Fixed

- **CI/CD**: Fixed duplicate 'strategy' key in workflow tier generation
  - The MATRIX_PLACEHOLDER replacement was creating duplicate YAML keys in quality.yml
  - Now correctly merges matrix configuration with existing strategy block
  - Also fixes standard mode to properly combine branch check with test-count condition
  - Prevents "Map keys must be unique" errors during GitHub Actions workflow validation

## [5.4.2] - 2026-01-08

### Fixed

- **CI/CD**: Fixed duplicate 'if' key in workflow tier generation for minimal/standard modes
  - The SECURITY_CONDITION_PLACEHOLDER replacement was creating duplicate YAML keys in quality.yml
  - Now correctly merges schedule condition with dependency check using && operator
  - Prevents "Map keys must be unique" errors during GitHub Actions workflow validation

## [5.4.1] - 2026-01-08

### Added

- **Workflow Tiers**: Three CI/CD optimization tiers to control GitHub Actions costs
  - **Minimal (default)**: Single Node version, weekly security, path filters (~$0-5/mo)
  - **Standard**: Matrix on main branch only, weekly security, path filters (~$5-20/mo)
  - **Comprehensive**: Matrix on every push, inline security, no filters (~$100-350/mo)
  - Flags: `--workflow-minimal`, `--workflow-standard`, `--workflow-comprehensive`
  - Auto-detection: Preserves existing mode on update, detects legacy workflows
  - Cost reduction: 60-95% savings for typical projects by defaulting to minimal
  - Version markers: `# WORKFLOW_MODE: <tier>` for reliable mode detection
  - See [CI-COST-ANALYSIS.md](docs/CI-COST-ANALYSIS.md) for full analysis
- **Shell Script Support**: Quality automation for Bash/Shell scripts
  - Example workflows and configs in `config/shell-*.yml` and `.github/workflows/shell-*.example`
- **CI Cost Analysis**: New `npm run analyze-ci` command to analyze GitHub Actions costs
  - Detailed cost breakdown by workflow, job, and step
  - Recommendations for cost optimization

### Fixed

- **CI/CD**: Fixed gitleaks secret detection failures with wildcard `.gitleaksignore` entries
  - Root cause: GitHub Actions creates temporary merge commits with changing hashes
  - Solution: Added `file:rule:line` entries (without commit hash) to match any commit
- **CI/CD**: Added missing `scripts/validate-claude-md.js` validation script
- **Documentation**: Fixed README reference to non-existent `npm run validate:prelaunch` script
- **Error Handling**: Comprehensive improvements to error messaging and recovery (10 critical/high fixes)
  - `safeReadDir()`: Now re-throws critical filesystem errors (EACCES, EIO, ELOOP, EMFILE) instead of silently returning empty arrays
  - `loadUsage()`: Enhanced FREE tier corruption handling with step-by-step recovery instructions
  - `saveUsage()`: Prevents FREE tier quota bypass by halting execution on write failures
  - Smart strategy template errors now include troubleshooting steps and reinstall guidance
  - Package.json parse errors include error IDs and recovery commands (e.g., `jq` validation)
  - Validation errors now throw when generated configs fail (indicates tool bug)
  - GitHub API errors provide specific diagnosis for 401, 404, network, rate limit issues
  - Directory scan permission errors always logged (affects maturity detection accuracy)
- **Testing**: Added comprehensive test coverage for result-types module (0% → 100%)
  - 23 new test cases covering success/failure/valid/invalid builders and checkers
  - Overall project coverage improved from 72.86% to 76%+
- **Testing**: Isolated Free/Pro tier test flows with environment overrides
  - Added isolated license directories per test to prevent state pollution
  - Wired env overrides (QAA_LICENSE_DIR, QAA_DEVELOPER, NODE_ENV) into setup runs
  - Made license gating deterministic for JS/TS/CSS/Python test scenarios
  - Fixed script output mismatches between expected Free tier scripts and actual output
  - Each test now creates its own license environment for reliable isolation

## [5.3.1] - 2026-01-01

### Fixed

- **Security**: Removed hardcoded dev secret fallback in license verification (TD1)
- **Security**: Fixed command injection vulnerability in linkinator integration (TD3)
- **Security**: Added path traversal validation for QAA_LICENSE_DIR and LICENSE_DATABASE_PATH
- **Security**: Fixed writeQueue promise chain to properly propagate errors
- **Security**: Added production safety checks to isDeveloperMode() and verifyLicenseSignature()
- **Security**: Rate limiting on public endpoints (health: 60 req/min, database: 30 req/min) prevents DoS attacks (DR19)
- **Security**: Frozen LICENSE_TIERS and deep-frozen FEATURES constants prevent mutation (DR23)
- **Security**: Timing-safe Bearer token comparison in /status endpoint prevents timing attacks (DR15)
- **Security**: Enhanced signature verification errors with specific error types (DR16)
- **Security**: Dev mode only bypasses missing signatures, validates when present (DR17)
- **Security**: Email format validation before hashing prevents timing attacks (DR21)
- **Code Quality**: Removed underscore-prefixed unused variables across codebase (TD4)
- **Code Quality**: Added DEBUG-gated logging to empty catches across codebase
- **Code Quality**: Added error differentiation in loadLegitimateDatabase (EACCES vs SyntaxError)
- **Code Quality**: Added backup before overwrite in addLegitimateKey for corrupt databases
- **Code Quality**: Production stack traces limited to 3 lines to prevent information leakage (DR20)
- **Code Quality**: Specific package.json error messages for syntax errors and permissions (DR22)
- **Code Quality**: Tier validation in saveLicense() functions (DR24)
- **Code Quality**: Converted promptLicenseActivation to async/await pattern (DR27)

### Added

- **Code Consistency**: Created lib/result-types.js for standardized result patterns across modules (DR25)
- **Architecture**: Documented comprehensive refactoring plan for setup.js (DR26)

### Removed

- **create-saas-monetization.js** - Separated from qa-architect; this was a standalone SaaS monetization generator not related to the core quality automation product

### Changed

- **Security**: License signing migrated from HMAC to Ed25519 public/private key cryptography
  - Client-side verification no longer requires shared secrets
  - Signed public registry for tamper-proof license distribution
  - Atomic file writes prevent database corruption
  - Unknown Stripe price IDs now fail explicitly (no silent fallback)
- **Security**: Gitleaks execution uses `spawnSync` with args array to prevent command injection
- **Architecture**: Extracted command handlers from `setup.js` to `lib/commands/` for maintainability (TD2)
  - New modules: `lib/commands/validate.js`, `lib/commands/deps.js`, `lib/commands/index.js`
  - Reduces setup.js from 2100+ lines, improves testability

## [5.3.0] - 2025-12-29

### Added

- **Pre-Launch Validation Suite** - Automated SOTA checks for web applications:
  - **SEO Validation** (Free) - Sitemap, robots.txt, meta tags validation
  - **Link Validation** (Free) - Broken link detection with linkinator
  - **Accessibility Validation** (Free) - WCAG 2.1 AA compliance with pa11y-ci
  - **Documentation Validation** (Free) - README completeness, required sections
  - **Env Vars Audit** (Pro) - Validate .env.example against code usage

- New `--prelaunch` CLI flag to add pre-launch validation to any project

- New feature flags in licensing: `prelaunchValidation`, `seoValidation`, `linkValidation`, `docsValidation`, `envValidation`

- New npm scripts added automatically:
  - `validate:sitemap` - Check sitemap.xml validity
  - `validate:robots` - Check robots.txt validity
  - `validate:meta` - Check meta tags completeness
  - `validate:links` - Detect broken links
  - `validate:a11y` - Run WCAG 2.1 AA accessibility audit
  - `validate:docs` - Check documentation completeness
  - `validate:env` - Audit env vars (Pro only)
  - `validate:prelaunch` - Run all pre-launch checks

- New validation scripts generated in `scripts/validate/`:
  - `sitemap.js`, `robots.js`, `meta-tags.js`, `links.js`, `a11y.js`, `docs.js`, `env.js`, `prelaunch.js`

- New config file: `.pa11yci` for accessibility configuration

- New devDependencies added: `linkinator`, `pa11y-ci`

### Changed

- Updated tier features to include pre-launch validation tools

## [5.2.0] - 2025-12-29

### Added

- **Quality Tools Integration** - New quality automation tools for all users:
  - **Lighthouse CI** (Free: basic scores, Pro: custom thresholds) - Performance, accessibility, SEO, best practices audits
  - **Bundle size limits** (Pro) - Enforce bundle size budgets with size-limit
  - **axe-core accessibility** (Free) - WCAG compliance testing scaffolding
  - **Conventional commits** (Free) - commitlint with commit-msg hook for consistent commit messages
  - **Coverage thresholds** (Pro) - Enforce code coverage minimums (70% lines, 70% functions)

- New feature flags in licensing: `lighthouseCI`, `lighthouseThresholds`, `bundleSizeLimits`, `axeAccessibility`, `conventionalCommits`, `coverageThresholds`

- New npm scripts added automatically:
  - `lighthouse:ci` - Run Lighthouse CI audits
  - `size` / `size:why` - Check bundle sizes (Pro)
  - `test:a11y` - Run accessibility tests
  - `test:coverage:check` - Check coverage thresholds (Pro)

- New config files generated:
  - `lighthouserc.js` - Lighthouse CI configuration
  - `commitlint.config.js` - Conventional commits rules
  - `.husky/commit-msg` - Commit message validation hook
  - `tests/accessibility.test.js` - axe-core test scaffolding

### Changed

- Updated tier features to include quality tools
- BACKLOG.md restructured with value-based prioritization

## [5.1.0] - 2025-12-26

### Added

- License validation and security test improvements
- New test files for:
  - Dockerfile secrets redaction handling
  - Gitleaks download redirect handling
  - License validator integrity checks
  - npm audit parsing validation
- Auto-create GitHub release on tag push (CI workflow)

### Changed

- Enhanced license-validator.js and licensing.js
- Improved config-security validation

### Fixed

- Handle actionlint WASM limitations gracefully

## [5.0.7] - 2025-12-12

### Added

- Dependabot auto-merge workflow for patch/minor dependency updates
- Published `BACKLOG.md` to share upcoming roadmap items

### Changed

- Updated pricing to $19/mo Pro with Team/Enterprise now contact-us (README, LICENSE, billing dashboard, CLI upgrade messaging)
- Bumped packaging/docs tooling (@npmcli/package-json 7.0.4, markdownlint-cli2 0.20.0)

## [5.0.6] - 2025-12-12

### Fixed

- Fixed gitleaks binary checksum verification - checksums now correctly match extracted binaries (not tarball archives)
- Updated all platform checksums: linux-x64, darwin-x64, darwin-arm64, win32-x64
- Fixed real binary test URL (linux_amd64 -> linux_x64)
- Fixed npm trusted publisher by upgrading npm in release workflow (requires npm 11.5.1+)

## [5.0.3] - 2025-12-11

### Changed

- Updated all VBL URLs from `/qaa` to `/tools/qa-architect` for consistency with new site structure
- License validation now uses `vibebuildlab.com/api/licenses/qa-architect.json` instead of subdomain

## [5.0.2] - 2025-12-07

### Fixed

- TypeScript type-check hygiene (Ajv imports, lint-staged merge typing, template maps, ora import, cache manager verbosity, maturity output typing)
- E2E packaging script now uses isolated npm cache and disables husky for reliable tarball testing

## [5.0.1] - 2025-12-03

### Added

- CI provider selector (`--ci github|gitlab|circleci`) with new GitLab and CircleCI workflow templates
- Optional collaboration hooks for GitHub CI (`--alerts-slack`, `--pr-comments`) to send Slack alerts and PR summary comments
- Default test scaffolding now includes unit and e2e smoke stubs to keep new projects green
- New docs: SLA/merge-gate recommendations (`docs/SLA_GATES.md`) and SOC 2 starter checklist (`docs/security/SOC2_STARTER.md`)

### Fixed

- Packaging: ensure templates/docs ship in the npm tarball
- Resolved Python setup crash when non-GitHub CI providers are selected

## [5.0.0] - 2025-11-30

### Breaking Changes

- **Renamed to QA Architect** (`create-qa-architect`)
  - Package renamed from `create-quality-automation` to `create-qa-architect`
  - All URLs updated from `/cqa` to `/qaa`
  - Update your install commands: `npx create-qa-architect@latest`

- **Commercial License** (freemium model)
  - Changed from MIT to Commercial License
  - Free tier remains free for personal and commercial use
  - Pro features require paid subscription

### Added

- **4-Tier Pricing Structure**
  - Free: $0 (basic CLI, 1 private repo, 50 runs/mo cap)
  - Pro: $19/mo or $190/yr (security scanning, Smart Test Strategy, unlimited)
  - Team: Contact us (RBAC, Slack alerts, team dashboard) - coming soon
  - Enterprise: Contact us (SSO/SAML, compliance, dedicated TAM) - coming soon

- **Smart Test Strategy** (Pro feature)
  - Risk-based pre-push validation (70% faster)
  - Project type detection (CLI, Web, SaaS, API, Library, Docs)
  - Risk scoring: High (≥7), Medium (4-6), Fast (2-3), Minimal (0-1)

- **Security Scanning** (Pro feature)
  - Gitleaks integration for secrets detection
  - ESLint security plugin rules
  - Feature-gated to Pro+ tiers

- **Usage Cap Enforcement** (Free tier)
  - 1 private repo limit
  - 50 pre-push runs per month
  - 10 dependency PRs per month
  - Monthly reset with tracking

### Changed

- Pro included in Vibe Lab Pro bundle
- Team/Enterprise are standalone purchases
- Aligned with Vibe Build Lab product strategy

## [4.2.0] - 2025-11-24

### Added

#### 💰 SaaS Monetization System

- **Complete Revenue System Template** (`create-saas-monetization.js`)
  - Full SaaS monetization template generator for any project
  - Stripe payment integration with webhook handlers
  - License key generation and validation
  - Customer billing dashboard
  - Email campaign templates
  - Legal compliance documents (terms, privacy, copyright)
  - Battle-tested revenue model ($1,750-2,500/month potential)

- **SHA256 Integrity Verification** (`lib/licensing.js`, `lib/license-validator.js`)
  - Mandatory cryptographic checksums for license databases
  - Prevents license database tampering
  - License validator rejects databases without valid checksums
  - Webhook handlers automatically calculate and embed checksums
  - Security bulletin QAA-2024-001 addressing validation bypass vulnerabilities

- **License Management Tools** (`admin-license.js`)
  - Command-line tool for license database management
  - Add legitimate license keys after purchase
  - SHA256 checksum generation and verification
  - Database integrity validation

- **Security Tests** (`tests/security-licensing.test.js`, `tests/real-purchase-flow.test.js`)
  - Comprehensive security-focused licensing tests
  - License validation bypass prevention tests
  - Stripe initialization security tests
  - License signature validation tests
  - Local license file tampering detection
  - End-to-end purchase flow validation

- **Documentation** (`SAAS_TEMPLATE_GUIDE.md`, `REVENUE_SYSTEM_SUMMARY.md`)
  - Complete SaaS template integration guide
  - Revenue system architecture documentation
  - Security advisory and migration guides
  - Implementation examples and patterns

### Changed

- **ESLint 9 Compatibility** (`eslint.config.cjs`)
  - Migrated deprecated `.eslintignore` to flat config `ignores` array
  - Eliminated ESLintIgnoreWarning during lint runs
  - Comprehensive ignore patterns with improved ESLint 9 support
  - Removed deprecated `.eslintignore` file

### Security

- **Critical Security Fixes**
  - Fixed license validation bypass vulnerability (CVE-pending)
  - Added mandatory SHA256 integrity verification
  - Cryptographic signature validation for license files
  - Tamper detection for local license files
  - Network-based license validation with offline fallback

## [4.1.1] - 2025-11-23

### Fixed

- **Gitleaks Binary Resolution** (`lib/gitleaks-manager.js`)
  - Improved reliability of gitleaks binary resolution tests
  - Better handling of network failures during binary downloads
  - Added `.gitleaksignore` to resolve false positives in test files

- **YAML Generation** (`lib/dependency-monitoring-premium.js`, `lib/dependency-monitoring-basic.js`)
  - Fixed inconsistent YAML generation by using `js-yaml` consistently
  - Removed dependency on `yaml` package
  - More reliable YAML output formatting

- **Test Isolation** (`tests/licensing.test.js`)
  - Fixed EPERM errors in parallel test runs
  - Proper temporary directory isolation for licensing tests
  - Improved test cleanup and teardown

## [4.1.0] - 2025-11-21

### Added

#### 🚀 Performance & UX Improvements

- **Progress Indicators** (`lib/ui-helpers.js`)
  - Added `ora` spinner library for visual feedback during long operations
  - 10 progress spinners across setup and validation flows
  - Automatic TTY detection with graceful CI/CD fallback
  - Visual feedback for: npm audit, gitleaks, ESLint security, template loading, git operations

- **Accessibility Support** (`lib/ui-helpers.js`)
  - `NO_EMOJI=true` environment variable for screen reader compatibility
  - `SCREEN_READER=true` alternative flag
  - Text-only mode: `[OK]`, `[ERROR]`, `[WARN]`, `[INFO]` instead of emoji
  - Automatic non-TTY detection for CI/CD environments
  - Graceful degradation when ora not available

- **Configuration Validation** (`lib/config-validator.js`, `config/quality-config.schema.json`)
  - JSON Schema validation for `.qualityrc.json` configuration files
  - `--validate-config` CLI flag for on-demand validation
  - Comprehensive error messages with field-specific guidance
  - Schema includes: version format, maturity enum, checks structure validation
  - Added `ajv` and `ajv-formats` dependencies for validation

- **Automated Dependency Management** (`.github/dependabot.yml`)
  - Weekly automated dependency updates for npm packages
  - Weekly automated updates for GitHub Actions
  - Grouped non-security updates for easier review
  - Separate security updates (always individual PRs)
  - PR limit configuration to prevent overwhelming CI

- **Test Coverage for Scripts** (37 new test cases)
  - `tests/check-docs.test.js` - 12 tests for documentation consistency script
  - `tests/validate-claude-md.test.js` - 15 tests for CLAUDE.md validation script
  - `tests/validate-command-patterns.test.js` - 10 tests for deprecated pattern detection
  - All scripts now have comprehensive test coverage
  - Tests verify exit codes, error messages, and edge cases

### Changed

#### ⚡ Performance Optimizations

- **Parallel Validation Default** (`lib/validation/index.js`, `setup.js`)
  - Changed default from sequential to parallel validation execution
  - **3-5x speedup**: 20-30 seconds → 6-10 seconds for comprehensive validation
  - All validation checks now run concurrently using `Promise.all()`
  - Maintains error collection and proper exit codes

- **Framework Detection Optimization** (`lib/dependency-monitoring-premium.js`)
  - Refactored nested loops to single-pass algorithm
  - **70-90% speedup**: 50ms → 5-10ms for dependency framework detection
  - Complexity reduced from O(F×C×P×D) to O(F×C×P + D×patterns)
  - Built reverse lookup map for pattern matching
  - Maintains identical detection results with better performance

### Fixed

#### 🔒 Security Fixes

- **Critical: Regex Catastrophic Backtracking** (`lib/dependency-monitoring-premium.js`)
  - Fixed unsafe regex patterns with `(.*)$` causing potential DoS
  - Replaced with bounded patterns `([^\s]*)$` to prevent catastrophic backtracking
  - Fixed in Python requirements.txt parser (line 449)
  - Fixed in pyproject.toml parser (line 494)
  - Removed `eslint-disable security/detect-unsafe-regex` comments

### Documentation

- **Environment Variables** (`README.md`)
  - Added documentation for `NO_EMOJI` and `SCREEN_READER` variables
  - Added documentation for existing `QAA_TELEMETRY` and `QAA_ERROR_REPORTING`
  - Usage examples for accessibility features

- **Configuration Schema** (`.qualityrc.json.example`)
  - Added `$schema` reference to enable IDE autocomplete and validation
  - Points to `./config/quality-config.schema.json`

### Developer Experience

- **Better Error Messages**
  - Configuration validation errors include field path and expected values
  - Progress spinners prevent "tool is frozen" confusion
  - Accessibility mode improves experience for screen reader users

### Testing

- **All tests passing** (37 suites, 300+ test cases)
- **New test coverage**: Scripts previously untested now at 100% coverage
- **Performance**: Tests complete faster with optimized framework detection

### Dependencies

- **Added**: `ora@8.1.1` - Terminal spinners for progress indication
- **Added**: `ajv@latest` - JSON Schema validator for configuration
- **Added**: `ajv-formats@latest` - Format validators for ajv (date-time, etc.)

### Upgrading from 4.0.0

No breaking changes. All new features are opt-in or automatic enhancements:

1. **Automatic benefits** (no action needed):
   - Faster validation (parallel by default)
   - Optimized framework detection
   - Progress spinners in interactive environments

2. **Optional features**:
   - Set `NO_EMOJI=true` for accessibility mode
   - Run `npx create-qa-architect@latest --validate-config` to validate `.qualityrc.json`
   - Dependabot will automatically create PRs for dependency updates

3. **For contributors**:
   - Scripts now have comprehensive tests (run `npm test`)
   - All regex patterns now safe from catastrophic backtracking

---

## [4.0.0] - 2025-11-20

### Added

#### 🎯 Progressive Quality Automation

**Major new feature:** Adaptive quality checks that automatically adjust based on project maturity, eliminating false failures in early-stage projects.

- **Project Maturity Detection** (`lib/project-maturity.js`)
  - Auto-detects 4 maturity levels: minimal, bootstrap, development, production-ready
  - Counts source files, test files, CSS files
  - Detects documentation presence and dependencies
  - CLI command: `npx create-qa-architect@latest --check-maturity`
  - GitHub Actions compatible output format (`--github-actions`)
  - 84%+ code coverage with 23 comprehensive tests

- **Progressive Workflow** (`.github/workflows/quality.yml`)
  - **Minimal projects** (0 source files): Only Prettier runs
  - **Bootstrap projects** (1-2 files): + ESLint
  - **Development projects** (3+ files + tests): + Tests + Security audits
  - **Production-ready** (10+ files + docs): All checks enabled
  - Conditional job execution saves CI time and eliminates noise
  - Summary job reports what checks ran and why in PR summaries

- **Manual Override Support** (`.qualityrc.json`)
  - Auto-generated during setup with detected maturity
  - Set `maturity: "production-ready"` to force all checks
  - Set `maturity: "minimal"` to disable most checks
  - Per-check `enabled: true/false/"auto"` configuration
  - Tracks detection metadata (source count, test count, detected timestamp)

- **Existing Project Migration**
  - `--update` flag automatically upgrades to progressive workflow
  - Generates `.qualityrc.json` with current project state
  - Zero breaking changes - auto-detection ensures smooth transition
  - Old workflow preserved as `.github/workflows/quality-legacy.yml.backup`

### Changed

- **Default workflow** is now progressive (was strict)
  - New projects get adaptive checks by default
  - Early-stage projects no longer fail CI with false negatives
  - Old behavior available via `.qualityrc.json` manual override

- **Setup process** now includes maturity detection
  - Shows detected level during setup
  - Generates `.qualityrc.json` automatically
  - Explains which checks will run at current maturity level

### Fixed

- Early-stage projects failing CI/CD checks unnecessarily
- Noise from checks on projects without assets (tests, docs, dependencies)
- Unclear which failures matter vs. expected for project stage

### Testing

- Added 23 comprehensive tests (84.71% statement coverage, 93.33% function coverage)
  - `tests/project-maturity.test.js` - 15 unit tests for maturity detection
  - `tests/project-maturity-cli.test.js` - 8 CLI integration tests
  - Tests all 4 maturity levels with realistic project structures
  - Tests edge cases (no package.json, nested files, TypeScript, multiple test locations)

### Documentation

- `.github/PROGRESSIVE_QUALITY_PROPOSAL.md` - Full design document (200+ lines)
- `.github/PROGRESSIVE_QUALITY_IMPLEMENTATION.md` - Integration guide with testing scenarios
- `QUALITY_CHECKS_OVERVIEW.md` - Current check breakdown and workflows
- `QUALITY_CHECKS_QUICK_REFERENCE.md` - Visual flow diagrams
- `QUALITY_CHECKS_MATRIX.md` - Failure matrix with debugging commands

### Upgrading

**For new projects:** No action needed - progressive checks are default

**For existing projects:**

```bash
# Option 1: Update your configuration (recommended)
npx create-qa-architect@latest --update

# Option 2: Check your maturity level
npx create-qa-architect@latest --check-maturity

# Option 3: Force strict mode (disable progressive)
# Edit .qualityrc.json: set "maturity": "production-ready"
```

**Breaking Changes:** None - auto-detection ensures backward compatibility

---

## [3.1.1] - 2025-11-16

### Fixed

- **🐛 Critical Python Parser Bug Fixes**
  - **HIGH: PEP 621 list-style dependencies never parsed** - Modern Python projects using `dependencies = ["package>=1.0.0"]` format had zero dependencies detected, losing all premium features (Dependabot grouping, framework detection). Parser only matched legacy `package = "^1.0.0"` format.
  - **HIGH: Inline comments after `]` break PEP 621 parsing** - Files with `]  # end of dependencies` failed to parse, returning empty dependency list.
  - **MEDIUM: Dotted package names rejected** - Python namespace packages (`zope.interface`, `google.cloud-storage`, `backports.zoneinfo`, `ruamel.yaml`) were parsed as truncated names (`zope`, `google`) with empty versions, breaking framework detection for scientific/cloud packages.
  - **MEDIUM: Metadata pollution** - Key/value parser treated `[project.urls]` homepage values and other metadata as dependencies, polluting framework counts and Dependabot configuration.

- **📦 Python Parser Enhancements**
  - Support PEP 621 main `dependencies = [...]` arrays
  - Support `[project.optional-dependencies]` with hyphenated group names (`lint-tools`, `test-suite`, `docs-build`)
  - Support dotted package names (`.` in package identifiers)
  - Support package extras (`fastapi[all]>=0.110.0`, `uvicorn[standard]>=0.24.0`)
  - Handle inline comments after closing brackets and within dependency lists
  - Scope legacy key/value parsing to dependency sections only (exclude `[project.urls]`, `[build-system]`, etc.)
  - Skip Python version specifiers (`python = "^3.8"`)

### Added

- **🧪 Comprehensive Python Parser Test Suites**
  - `tests/python-parser-fixes.test.js`: 8 test scenarios covering PEP 621, dotted packages, hyphenated groups, real-world files (540+ lines)
  - `tests/pyproject-parser-bug-reproduction.test.js`: Bug reproduction tests (235 lines)
  - Test coverage: PEP 621 arrays, dotted names, optional-dependencies, inline comments, metadata exclusion, edge cases

- **📚 Process Improvement Documentation**
  - `claudedocs/parser-bugs-lessons-learned.md`: Systematic process improvements for future parser work
  - `claudedocs/bug3-monorepo-subdirectory-design.md`: Design document for deferred monorepo subdirectory detection (v3.2.0)
  - Research protocol for pre-implementation edge case discovery
  - Real-world test data methodology

### Notes

- **Monorepo subdirectory detection** (Bug #3) deferred to v3.2.0 - requires architectural changes
- Workaround: Run CLI in each service directory manually (`cd services/api && npx create-qa-architect --deps`)
- All 22+ test suites passing with new parser fixes

## [3.1.0] - 2025-11-15

### Added

- **🧪 Comprehensive Test Coverage Improvements**
  - **validation-factory.js**: 0% → 85.16% (+85.16%)
  - **dependency-monitoring-premium.js**: 66.73% → 91.88% (+25.15%)
  - **setup.js**: 74.07% → 79.46% (+5.39%)
  - **Overall project**: 71.09% → 79.73% (+8.64%)
  - All coverage targets met or exceeded (≥75% overall, ≥80% critical paths)

- **📚 CONTRIBUTING.md Developer Guidelines**
  - Pre-commit quality gates (Husky + ESLint + Prettier)
  - Test-first development workflow with examples
  - Coverage requirements (75%+ all files, 80%+ critical)
  - Real-world data testing patterns
  - Error prevention strategies
  - Code change verification protocol
  - Common patterns (DI, error handling, validation)
  - Release process and post-mortem workflow

- **🎯 New Test Suites**
  - `tests/validation-factory.test.js`: Comprehensive DI pattern testing (360 lines)
  - `tests/setup-error-coverage.test.js`: Error path coverage for setup.js (280 lines)
  - `tests/python-detection-sensitivity.test.js`: Python detection validation (260 lines)
  - Integration tests validate real-world scenarios with 40+ packages from PyPI, crates.io, RubyGems

- **🌐 Global Framework Updates** (Permanent learnings in `~/.claude/RULES.md`)
  - **Code Change Verification Protocol**: Systematic search + verification methodology
  - **Test Quality & Coverage**: TDD + integration + real-world data requirements
  - Impact: All future projects benefit from v3.0.0 lessons

### Changed

- **Enhanced Python Detection Sensitivity** - Reduced false positives
  - **Before**: Single .py file anywhere triggered full Python setup
  - **After**: Requires stronger evidence
    - Config files (pyproject.toml, requirements.txt, setup.py, Pipfile) → Always detects
    - Multiple .py files (≥2) → Detects
    - Main patterns (main.py, app.py, run.py, **main**.py) → Detects
    - Single random .py file → NO detection (prevents false positives)
  - Impact: JS projects with utility scripts no longer get unexpected Python tooling
  - Validation: 6 comprehensive test scenarios covering all detection patterns

### Quality Metrics

- **Bug Detection Rate**
  - Unit tests only: 33% (1/3 bugs caught)
  - With integration tests: 100% (3/3 bugs caught)
  - Lesson: Integration tests essential for production quality

- **Real-World Validation**
  - 40+ packages tested from PyPI, crates.io, RubyGems
  - 100% parsing accuracy across all ecosystems
  - Dependency detection verified against production packages

- **Production Readiness**
  - ✅ Coverage: 79.73% (exceeds 70% industry standard)
  - ✅ Critical path coverage: 100%
  - ✅ Integration test coverage: 100% bug detection
  - ✅ Real-world validated: 40+ packages
  - ✅ Error handling: Comprehensive defensive code
  - ✅ Documentation: Complete CONTRIBUTING.md guide

### Documentation

- **claudedocs/v3.0.0-quality-improvements-summary.md**: Comprehensive documentation of all quality enhancements
- **claudedocs/global-framework-updates.md**: Universal lessons added to global framework
- Enhanced developer experience with clear contribution guidelines

### Developer Experience

- Test-first development workflow established
- Real-world data testing patterns documented
- Error prevention strategies codified
- Code change verification protocol implemented
- Coverage targets enforced (≥75% all files, ≥80% critical)

### Breaking Changes

None - All changes are backward compatible

---

## Previous Releases

### Added

- **🚀 PREMIUM-002: Multi-Language Dependency Monitoring (Pro Tier)** - **JUST SHIPPED!** Python, Rust, and Ruby ecosystem support
  - **Python/Pip ecosystem support**
    - Framework detection for Django (core, REST framework, async, CMS)
    - Framework detection for Flask (core, extensions, SQLAlchemy, CORS)
    - Framework detection for FastAPI (core, async runtime, validation)
    - Data Science stack detection (numpy, pandas, scipy, scikit-learn, TensorFlow, PyTorch, matplotlib)
    - Testing framework grouping (pytest ecosystem)
    - Web server grouping (gunicorn, uvicorn, waitress)
    - Dependency file parsing: requirements.txt and pyproject.toml
  - **Rust/Cargo ecosystem support**
    - Framework detection for Actix Web (core, middleware)
    - Framework detection for Rocket (core, features)
    - Async runtime grouping (Tokio, async-std, futures)
    - Serde ecosystem grouping (serde, serde_json, serde_yaml)
    - Testing framework grouping (criterion, proptest)
    - Cargo.toml parsing with inline table support
  - **Ruby/Bundler ecosystem support**
    - Framework detection for Rails (core, database, testing, frontend)
    - Framework detection for Sinatra (core, extensions)
    - Testing framework grouping (RSpec, Minitest, Capybara, FactoryBot)
    - Utility grouping (Sidekiq, Faraday, HTTParty)
    - Gemfile parsing with version constraints
  - **Polyglot repository support**
    - Single Dependabot config supporting npm + pip + cargo + bundler simultaneously
    - Automatic ecosystem detection from project files
    - Independent update schedules per ecosystem
    - Framework-aware grouping across all languages
    - Ecosystem-specific labels and commit message prefixes
  - **Comprehensive test coverage**: 15 tests covering all languages, frameworks, and edge cases
  - **Implementation**: Extended `lib/dependency-monitoring-premium.js` to 1200+ lines
  - **Zero external dependencies**: Simple regex-based parsing for all file formats

- **🚀 PREMIUM-001: Framework-Aware Dependency Grouping (Pro Tier)** - **SHIPPED AND LIVE!** Flagship premium feature reducing dependency PRs by 60%+
  - Intelligent dependency batching by framework (React, Vue, Angular)
  - Reduces dependency PRs by 60%+ for React projects (15+ individual PRs → 3-5 grouped PRs)
  - Automatic framework detection from package.json
  - Supports React ecosystem (core, state management, routing, UI libraries)
  - Supports Vue ecosystem (core, router, pinia, ecosystem packages)
  - Supports Angular ecosystem (core, common, router, state management)
  - Testing framework grouping (Jest, Vitest, Testing Library, Playwright)
  - Build tool grouping (Vite, Webpack, Turbo, Nx, Rollup)
  - Storybook ecosystem grouping
  - Wildcard pattern matching for scoped packages (@tanstack/_, @radix-ui/_, etc.)
  - Update-type filtering (major vs minor vs patch)
  - Dependency-type awareness (production vs development)
  - License tier validation (Pro/Enterprise only)
  - Generated Dependabot configs include framework detection comments
  - Comprehensive test suite (14 tests covering all frameworks and edge cases)
  - Implementation: `lib/dependency-monitoring-premium.js` (500+ lines)
  - Integration: `setup.js` updated to use premium config for licensed users
  - Free tier users see upgrade prompt with concrete example of PR reduction

- **Custom template support** - New `--template <path>` flag enables organizations to use custom coding standards
  - Load template files from local directory to override package defaults
  - Partial template support - custom templates can override specific files while falling back to defaults for others
  - Nested directory support - templates can include subdirectories (e.g., `.github/workflows/`, `config/`)
  - Path characters preserved - Special characters like `&` in directory names handled correctly
  - Use case: Enforce organization-specific linting rules, CI/CD workflows, and coding standards across projects

### Changed

- **Dependency monitoring setup enhanced** - `--deps` flag now routes to tier-appropriate config
  - Free tier: Basic Dependabot config (npm + github-actions, no grouping)
  - Pro/Enterprise tier: Framework-aware grouping with intelligent batching
  - License tier displayed during setup
  - Detected frameworks logged for Pro/Enterprise users
  - Upgrade messaging updated to show "Available now" for framework grouping
- **Premium tier pricing** - Beta launch pricing announced
  - Pro tier: $19.50/mo for 3 months (50% off, then $39/mo)
  - Enterprise tier: $98.50/mo for 3 months (50% off, then $197/mo)
  - Beta duration: December 2025 - February 2026

### Fixed

- **🚨 CRITICAL: TypeError in framework detection** - Fixed crash when `dependencies` or `devDependencies` are undefined
  - Issue: Fresh apps or projects with only devDependencies would crash with "Cannot convert undefined or null to object"
  - Fix: Added `|| {}` default values in `detectFrameworks()` function (lib/dependency-monitoring-premium.js:91-94)
  - Impact: Framework-aware grouping now works for all project configurations
  - Test: Added comprehensive Test 11b covering all edge cases (missing dependencies, missing devDependencies, both missing)
  - Discovered by: User testing before beta launch - prevented production bug
- **Path sanitization for --template flag** - Template directory paths now preserve special characters (`&`, `<`, `>`, etc.) that are valid in file paths
  - Previously: `validateAndSanitizeInput` stripped these characters, breaking legitimate paths like "ACME & Co"
  - Now: Template path read from raw CLI args before sanitization

## [2.6.1] - 2025-11-12

### Fixed

- **🚨 CRITICAL**: Workflow validation steps using conditional setup.js checks that always fall back to weaker validation
  - Configuration security check now uses `npx create-qa-architect@latest --security-config`
  - Documentation validation now uses `npx create-qa-architect@latest --validate-docs`
  - Previously: `if [ -f "setup.js" ]` was always false in consumer repos, silently falling back to basic grep checks
  - Impact: Consumer repos now get comprehensive validation instead of weak fallback checks
- **📖 README accuracy**: Removed "Auto-merge for security patches only" claim from Dependabot feature list
  - Auto-merge is NOT included in basic Dependabot configuration
  - Added note that auto-merge requires manual GitHub Actions workflow setup
  - Provided link to GitHub documentation for auto-merge setup

---

## [2.6.0] - 2025-11-12

### Added

- **Progress indicators** for validation operations - Shows [X/3] step progression during comprehensive validation
- **--dry-run mode** - Preview what files would be created/modified without making changes
- **Comprehensive troubleshooting guide** (TROUBLESHOOTING.md) - Covers common issues, platform-specific problems, and solutions
- **Automatic E2E package testing** - Validates published package works for consumers before release
- **Root cause analysis document** (claudedocs/CODEX_FINDINGS_ANALYSIS.md) - Prevention strategies for future issues

### Fixed

- **🚨 CRITICAL**: Workflow references to non-existent setup.js in consumer repos - Removed problematic step
- **🚨 CRITICAL**: npm scripts using `node setup.js` instead of `npx create-qa-architect@latest`
- **.eslintignore missing from npm package** - Added to files array
- **Invalid Dependabot config schema** - Removed unsupported `update-type` keys
- Removed .npmrc from files array (npm excludes it automatically)

### Changed

- Enhanced prerelease checks to include E2E package validation
- npm scripts now use `npx create-qa-architect@latest` for CLI operations
- Improved workflow to avoid consumer-facing failures

### Developer Experience

- Added `npm run test:e2e` for comprehensive package validation
- Better error messages with context
- Enhanced documentation for troubleshooting

---

## [2.5.0] - 2025-11-11

### Added

- **🧪 Comprehensive Error Path Testing:** Added `tests/error-paths.test.js` with 6 error scenarios (ESLint missing, malformed JSON, permissions, missing deps, invalid config, missing package.json)
- **📚 CI README Verification:** GitHub Actions now tests Quick Start instructions from clean environment to catch broken documentation
- **🏗️ Base Validator Class:** Created `lib/validation/base-validator.js` with common error handling, state management, and validation patterns
- **🏭 Validation Factory:** Implemented dependency injection pattern in `lib/validation/validation-factory.js` for better testability and loose coupling

### Changed

- **⚡ ESLint Programmatic API:** Refactored security validation to use ESLint API instead of fragile shell parsing, providing precise file:line:column error locations
- **🔧 TypeScript Config Detection:** Now detects all ESLint config variants including `eslint.config.ts.cjs` for TypeScript-first projects
- **🛡️ Better Error Messages:** Centralized error formatting for ENOENT, EACCES, MODULE_NOT_FOUND with context-aware messages

### Fixed

- **🚨 CRITICAL**: ESLint security validation now properly fails when ESLint binary is missing instead of silently passing (resolves false positive security gates)
- **🚨 CRITICAL**: TypeScript projects using `eslint.config.ts.cjs` are now properly scanned (previously invisible to security scanner)
- **📖 Documentation Validation:** Implemented promised README file/script reference validation that was advertised but not implemented
- **🪟 Cross-platform Testing:** Replaced Unix-only `rm -rf` with `fs.rmSync()` for Windows compatibility

---

## [2.4.0] - 2025-11-04

### Added

- **🆓 Freemium Dependency Monitoring:** `--deps` command now scaffolds a Dependabot + GitHub Actions baseline for npm projects, auto-merging security patches by default.
- **📋 License Awareness:** CLI surfaces current tier details through `--license-status`, including upgrade prompts for Pro/Enterprise.

### Changed

- **📣 Documentation:** README now highlights the free tier entry point, premium upgrade paths, and dependency monitoring workflow.
- **🛠️ Validation Scripts:** `validate:comprehensive` bundles freemium configuration checks so repos stay aligned after upgrades.

---

## [2.3.3] - 2025-11-01

### Fixed

- **🚨 CRITICAL**: Made missing gitleaks binary block security validation instead of silently passing
  - v2.3.2 still allowed "✅ Security checks passed" when gitleaks was missing
  - Missing gitleaks now properly fails validation with clear error message
  - Users can use `--no-gitleaks` flag to explicitly skip if desired

---

## [2.3.2] - 2025-11-01

### Fixed

- **🚨 CRITICAL**: Fixed gitleaks error swallowing that caused false positives
  - Previous version silently ignored gitleaks failures (missing binary, permissions, etc.)
  - Security validation would pass with "✅ Security checks passed" even when gitleaks never ran
  - Now properly surfaces failures: info message for missing binary, blocking errors for other issues

---

## [2.3.1] - 2025-11-01

### Fixed

- **🚨 CRITICAL**: Fixed gitleaks invocation to use `npx` instead of `which` + bare command
  - Previous version silently skipped secret scanning on Windows and local npm installs
- **🚨 CRITICAL**: Fixed actionlint invocation to use `npx` instead of `which` + bare command
  - Previous version silently skipped workflow validation on Windows and local npm installs
- **🔧 MAJOR**: Fixed Python script setup to preserve existing scripts instead of overwriting
  - Previous version broke idempotency and clobbered custom python:\* commands

---

## [2.3.0] - 2025-11-01

### Changed

- **🔧 Mature Tool Integration**: Replaced custom implementations with industry-standard tools
  - `@npmcli/package-json` for robust package.json handling (replaces custom JSON manipulation)
  - `gitleaks` for comprehensive secret scanning (replaces regex patterns)
  - `actionlint` for GitHub Actions workflow validation
  - `markdownlint-cli2` for documentation validation (replaces custom parsing)

### Added

- **📱 Enhanced Windows Compatibility**: Replaced shell pipe dependencies with Node.js parsing
- **🧪 Comprehensive Integration Tests**: Prevents regressions across multiple environments
- **📦 Shared Package Utilities**: Extracted common functionality to eliminate code duplication
- **⚡ Lazy Loading**: Node.js 20+ requirement enforcement with proper dependency loading
- **🎛️ Granular Configuration**: Tool-specific disable options for advanced users
- **🚀 Automated Release Workflow**: Streamlined npm publishing and GitHub releases

### Fixed

- **Node Version Compatibility**: Proper enforcement of Node.js 20+ requirement
- **ESLint Config Detection**: Support for both `.js` and `.cjs` config file variants
- **Cross-Platform Reliability**: Eliminated grep and shell-specific commands
- **Package.json API Usage**: Correct usage of `PackageJson.create()` vs `PackageJson.load()`

---

## [2.2.0] - 2025-10-29

### Added

- **🔍 Configuration Security Scanner**: Detects client-side secret exposure in Next.js and Vite configs
- **📖 Documentation Accuracy Validator**: Ensures README file references and npm scripts actually exist
- **🎯 Enhanced CLI Commands**: New validation-only commands for targeted checks
- **🔧 Enhanced npm Scripts**: Template projects get comprehensive validation scripts

### New CLI Commands

- `npx create-qa-architect@latest --security-config` - Run configuration security scan
- `npx create-qa-architect@latest --validate-docs` - Validate documentation accuracy
- `npx create-qa-architect@latest --comprehensive` - Run all validation checks

### Enhanced GitHub Actions

- Configuration security validation in CI/CD pipeline
- Documentation accuracy checks for pull requests
- Fallback security checks for projects without setup.js

### Security Features

- **Next.js Security**: Detects secrets in `env` blocks that expose to client bundle
- **Vite Security**: Identifies `VITE_` prefixed secrets that are client-exposed
- **Docker Security**: Scans Dockerfiles for hardcoded secrets in ENV statements
- **Environment Security**: Validates .env file .gitignore patterns

### Documentation Features

- **File Reference Validation**: Checks that referenced files actually exist
- **Script Reference Validation**: Ensures documented npm scripts are available
- **Version Consistency**: Validates package.json version appears in CHANGELOG
- **Technology Alignment**: Checks description accuracy with detected technologies

### Testing

- **Comprehensive Test Suite**: Full test coverage for all validation features
- **Integration Tests**: End-to-end validation of security and documentation checks
- **Error Case Testing**: Validates that insecure configurations are properly caught

---

## [2.1.0] - 2025-10-28

### Added

- **🚢 Lighthouse CI Integration**: SEO and performance checking with configurable thresholds
- **SEO Validation**: Automated checking for meta descriptions, document titles, canonical URLs, and structured data
- **Performance Budgets**: Configurable thresholds for Core Web Vitals and accessibility scores

### Changed

- Enhanced GitHub Actions workflow with Lighthouse CI support
- Added `@lhci/cli` dependency for SEO and performance automation
- Setup script now creates `.lighthouserc.js` configuration automatically

### Documentation

- Updated README.md with comprehensive Python and Lighthouse CI documentation
- Added complete v2.0.0 and v2.0.1 release notes to CHANGELOG.md
- Enhanced feature documentation for multi-language support

---

## [2.0.1] - 2025-10-26

### Fixed

- **🐍 Enhanced Python lint-staged Integration**: Python files now get automatic quality checks on commit
- **Restored .eslintignore**: Added back for consistency (even though deprecated in ESLint 9)
- **Standardized Python Dependencies**: Using `~=` version pinning instead of `>=` for better stability

### Added

- Python lint-staged support for `.py` files with Black, Ruff, and isort
- Enhanced test coverage for Python lint-staged functionality

### Improved

- Python files now work with both Husky + lint-staged (JS/TS projects) and pre-commit hooks (Python-only)
- Better version consistency across Python toolchain dependencies

---

## [2.0.0] - 2025-10-26

### Added

- **🐍 Complete Python Support**: Full Python project detection and automation
- **Python Toolchain**: Black, Ruff, isort, mypy, pytest integration
- **Pre-commit Hooks**: Python-specific `.pre-commit-config.yaml` for Python projects
- **Dedicated Python Workflow**: `quality-python.yml` GitHub Actions workflow
- **Multi-language Projects**: Support for full-stack JavaScript + Python projects
- **Python Helper Scripts**: Additional package.json scripts for hybrid projects

### Infrastructure

- **Updated GitHub Actions**: Latest action versions (checkout@v5, setup-node@v6)
- **Enhanced Security**: Python-specific security pattern detection
- **Repository URLs**: Fixed package.json repository URLs
- **Comprehensive Testing**: Test coverage for Python functionality

### Technical

- **Project Detection**: Automatic detection via `.py` files, `pyproject.toml`, `requirements.txt`
- **Smart Configuration**: Python tooling only added to Python projects
- **Template Files**: `pyproject.toml`, `.pre-commit-config.yaml`, `requirements-dev.txt`
- **Workflow Integration**: Python quality checks run alongside JavaScript checks

### Breaking Changes

- **Removed Deprecated Files**: `.eslintignore` removed (restored in 2.0.1)
- **Enhanced Detection**: More comprehensive project type detection

---

## [1.1.0] - 2025-09-27

### Added

- **🔒 Enhanced Security Automation**: Comprehensive security scanning in GitHub Actions workflow
- **Blocking Security Audit**: npm audit now fails CI on high-severity vulnerabilities (removed `|| true`)
- **Hardcoded Secrets Detection**: Automated scanning for exposed passwords, API keys, and private keys
- **Improved CI Security**: Pattern matching for common secret formats and cryptographic keys

### Changed

- Updated GitHub Actions workflow template to enforce security standards
- Security checks now block deployments when vulnerabilities or secrets are detected

### Security

- Eliminated security bypass in npm audit (previously non-blocking)
- Added comprehensive secret pattern detection including:
  - Password/token/key assignments with long values
  - PEM-formatted private keys
  - Configurable exclusions for node_modules and .git directories

---

## [1.0.1] - 2025-09-27

### Changed

- Enhanced GitHub repository discoverability with comprehensive topic tags
- Updated repository metadata and documentation alignment

### Improved

- Repository now includes 14 relevant topics for better npm package discovery
- Homepage URL properly configured for GitHub repository

### Documentation

- Maintained comprehensive README with current feature set
- CHANGELOG format consistency improvements

---

## [1.0.0] - 2024-09-25

### Added

- 🎉 Initial release as npm package `create-qa-architect`
- ESLint 9 flat config support (`eslint.config.cjs`)
- Automatic TypeScript detection and configuration
- Husky v9 pre-commit hooks with lint-staged
- Prettier code formatting with sensible defaults
- Stylelint CSS/SCSS linting
- GitHub Actions quality workflow
- EditorConfig for IDE consistency
- Node 20 toolchain pinning (`.nvmrc`, `engines`, Volta)
- Comprehensive integration tests for JS and TypeScript projects
- Conservative setup that preserves existing configurations
- Idempotent operation - safe to run multiple times

### Features

- **Smart TypeScript Support**: Automatically detects TypeScript projects and configures `@typescript-eslint`
- **Modern Tooling**: ESLint 9 flat config, Husky 9, latest Prettier/Stylelint
- **Graceful Merging**: Preserves existing scripts, dependencies, and lint-staged configs
- **CLI Interface**: Run with `npx create-qa-architect@latest`
- **Update Support**: Re-run with `--update` flag for configuration updates

### Technical

- Migrated from legacy `.eslintrc.json` to modern `eslint.config.cjs`
- Replaced deprecated `husky install` with `husky` command
- Added comprehensive test coverage including idempotency checks
- Template files packaged and distributed via npm

---

## Future Releases

### Planned for v2.3.0

- Runtime validation framework (selective implementation)
- Build process validation
- Template compilation checks
- Enhanced CI/CD integration

### Planned for v2.4.0

- commitlint integration for conventional commits
- Jest/Vitest testing templates
- React/Vue framework presets
- Workspace/monorepo support

### Planned for v3.0.0

- Custom rule presets (strict, relaxed, enterprise)
- Plugin ecosystem for extended functionality
- Integration with popular CI providers (CircleCI, GitLab)
- Quality metrics dashboard

---

## Migration Notes

### From Pre-1.0 Template

If you were using the template repository directly:

1. **New Installation Method**:

   ```bash
   # Old way
   node /path/to/template/setup.js

   # New way
   npx create-qa-architect@latest
   ```

2. **Configuration Changes**:
   - `.eslintrc.json` → `eslint.config.cjs` (automatically handled)
   - `husky install` → `husky` (automatically updated)
   - Added TypeScript-aware ESLint configs when TS detected

3. **Update Existing Projects**:
   ```bash
   npx create-qa-architect@latest --update
   ```
