# Deployment Guide

## Overview

QA Architect is published to npm as `create-qa-architect`.

## Prerequisites

- Node.js 20+
- npm account with publish access
- Git repository access

## Release Process

### 1. Pre-Release Validation

```bash
npm run prerelease    # Run all tests and validations
npm run test:coverage # Verify coverage thresholds
```

### 2. Version Bump

```bash
npm run release:patch  # Bug fixes (1.0.x)
npm run release:minor  # New features (1.x.0)
npm run release:major  # Breaking changes (x.0.0)
```

### 3. Publish

GitHub Actions automatically publishes on tagged releases.

For manual publish:

```bash
npm publish
```

## Verification

After release, verify:

```bash
npx create-qa-architect@latest --version
npx create-qa-architect@latest --help
```

## Rollback

If issues are discovered:

```bash
npm unpublish create-qa-architect@VERSION
# or
npm deprecate create-qa-architect@VERSION "Critical bug, use VERSION instead"
```

## npm Registry

- Package: https://www.npmjs.com/package/create-qa-architect
- Documentation: https://github.com/buildproven/qa-architect
