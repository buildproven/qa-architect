# Turborepo Support

**Status**: ✅ Implemented (v5.10.0)
**Date**: 2026-01-19

## Overview

qa-architect now automatically detects and supports Turborepo monorepos. The CI workflow adapts to use Turborepo's task runner when `turbo.json` is present.

## Detection

The workflow automatically detects Turborepo by checking for `turbo.json`:

```yaml
# In detect-maturity job
if [ -f turbo.json ]; then
echo "is-turborepo=true" >> $GITHUB_OUTPUT
echo "turbo-prefix=turbo run" >> $GITHUB_OUTPUT
else
echo "is-turborepo=false" >> $GITHUB_OUTPUT
echo "turbo-prefix=" >> $GITHUB_OUTPUT
fi
```

## CI Workflow Integration

### Setup Requirements

For Turborepo projects using pnpm:

```yaml
# CRITICAL: Install pnpm BEFORE Node.js setup
- name: Install pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9

- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    node-version: '20'
    cache: 'pnpm' # Now works because pnpm was installed first
```

### Installing Turborepo

After dependencies are installed, add Turborepo globally if detected:

```yaml
- name: Setup Turborepo
  if: needs.detect-maturity.outputs.is-turborepo == 'true'
  run: npm install -g turbo
```

### Running Tasks

Use the `turbo-prefix` output to run tasks:

```yaml
# Standard project
- name: Run tests
  run: npm test

# Turborepo project (automatically uses turbo run)
- name: Run tests
  run: ${{ needs.detect-maturity.outputs.turbo-prefix }} test
```

## Example Workflow

See `.github/workflows/pnpm-ci.yml.example` for a complete Turborepo CI workflow.

## Project Structure

Typical Turborepo monorepo:

```
buildproven/
├── turbo.json              # Turborepo config (triggers detection)
├── package.json            # Root package with workspaces
├── pnpm-lock.yaml         # pnpm lockfile
├── apps/
│   ├── factory/           # App workspace
│   │   └── package.json
│   └── landing/           # App workspace
│       └── package.json
└── packages/
    ├── ui/                # Shared package
    │   └── package.json
    └── config/            # Shared config
        └── package.json
```

## Task Execution

Turborepo caches and parallelizes tasks based on `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {}
  }
}
```

## Benefits

- **Automatic detection**: No manual configuration needed
- **Task caching**: Turborepo caches tasks across CI runs
- **Parallel execution**: Run tasks across workspaces in parallel
- **Smart scheduling**: Only rebuild what changed
- **Workspace awareness**: Respects workspace dependencies

## Troubleshooting

### Issue: CI fails with "turbo: command not found"

**Solution**: Ensure Turborepo is installed globally:

```yaml
- name: Setup Turborepo
  if: needs.detect-maturity.outputs.is-turborepo == 'true'
  run: npm install -g turbo
```

### Issue: pnpm cache not working

**Solution**: Install pnpm **before** setup-node:

```yaml
- name: Install pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9

- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    cache: 'pnpm' # Must come after pnpm install
```

### Issue: "package.json not found" in subdirectory

This is expected in monorepos. qa-architect gracefully handles missing package.json in workspace subdirectories (see `docs/MONOREPO-COMPATIBILITY-FIX.md`).

## Testing

Test Turborepo detection:

```bash
cd ~/Projects/buildproven
npx create-qa-architect@latest --dry-run

# Should show:
# 📦 Turborepo detected - will use 'turbo run' for tasks
```

## Related Documentation

- [Monorepo Compatibility Fix](./MONOREPO-COMPATIBILITY-FIX.md) - Handling workspaces
- [CI Cost Analysis](./CI-COST-ANALYSIS.md) - Workflow tier pricing
- [pnpm CI Example](../.github/workflows/pnpm-ci.yml.example) - Complete example

---

**Status**: Production-ready, tested with buildproven monorepo
