# Contributing to create-qa-architect

## Error Prevention & Quality Standards

This document encodes lessons learned from v3.0.0 development to prevent recurring issues.

## Pre-Commit Quality Gates

**Already Enforced**:

- ✅ Husky + lint-staged catches ESLint errors before commit
- ✅ Prettier formatting enforced automatically
- ✅ Stylelint for CSS/SCSS files

**Process**: Pre-commit hooks run automatically on `git commit`. If errors occur, fix them and re-commit.

## Development Workflow

### Test-First Development (TDD)

**Why**: Integration tests caught Bug #2 (Python-only projects broken) that unit tests missed.

**Process**:

1. **Write integration test first** (Red phase)
2. **Implement minimum code to pass** (Green phase)
3. **Refactor with confidence** (Refactor phase)

**Example**:

```bash
# 1. Create failing test
echo "Test: Python-only project should create dependabot.yml" >> tests/new-feature.test.js

# 2. Run test (should fail)
npm test

# 3. Implement feature until test passes

# 4. Refactor code while keeping tests green
```

### Coverage Requirements

**Enforced Minimums**:

- **Overall**: 75%+ lines, statements, functions, branches
- **New files**: 75%+ coverage before merging
- **Critical files**:
  - `setup.js`: 80%+
  - `lib/dependency-monitoring-premium.js`: 75%+
  - `lib/validation/*.js`: 75%+

**Check coverage**:

```bash
npm run test:coverage
```

**View detailed report**:

```bash
npm run coverage  # Generates coverage report (see coverage/index.html)
```

### Real-World Data Testing

**Why**: PREMIUM-002 post-mortem identified "non-representative test data" as root cause.

**Pattern**:

```javascript
// ❌ Bad: Toy examples
const TEST_PACKAGES = ['foo', 'bar', 'baz']

// ✅ Good: Real packages from ecosystem
const TOP_PYTHON_PACKAGES = [
  'django-cors-headers',
  'scikit-learn',
  'pytest-cov',
  // ... top 20 packages
]
```

**Files implementing this**:

- `tests/real-world-packages.test.js` - 40+ real packages
- `tests/cli-deps-integration.test.js` - Real CLI workflows

## Error Detection Strategies

### 1. Static Analysis (ESLint)

**Current setup**: ESLint 9 flat config with security plugin

**Run manually**:

```bash
npm run lint        # Check for errors
npm run lint:fix    # Auto-fix where possible
```

### 2. Continuous Testing

**During development**:

```bash
# Terminal 1: Code editing
# Terminal 2: Fast loop
npm run test:fast  # Quick subset for iteration
```

### 3. Integration Test Coverage

**When to write integration tests**:

- CLI commands and flags (--deps, --template, --comprehensive)
- Multi-file operations (template copying, config generation)
- Cross-language features (npm + Python + Rust detection)
- User-facing workflows (npx create-qa-architect)

**Pattern**:

```javascript
// tests/cli-*.test.js
const { execSync } = require('child_process')
const testDir = createTempGitRepo()

const result = execSync('node setup.js --deps', { cwd: testDir })
assert(fs.existsSync(path.join(testDir, '.github/dependabot.yml')))
```

### 4. Pre-Release Checklist

**CRITICAL**: Before ANY version bump or npm publish:

```bash
npm run prerelease  # Runs docs:check + all tests + e2e
```

**Why**: Catches documentation gaps that manual review misses (learned from v2.1.0).

**Reference**:

- `.github/RELEASE_CHECKLIST.md` - Comprehensive checklist
- `scripts/check-docs.sh` - Automated verification

## Code Change Verification Protocol

### When Making ANY Code Change

**🚨 CRITICAL**: Use systematic search to find ALL instances:

```bash
# Example: Removing 'grep' usage
grep -r "grep" . --exclude-dir=node_modules --exclude-dir=.git
rg "grep" --type js --type ts
find . -name "*.js" -o -name "*.ts" | xargs grep "grep"
```

### After Edits: Verify Complete Removal

```bash
# Must return NO results
grep -r "target_pattern" . --exclude-dir=node_modules --exclude-dir=.git
```

### Test the Specific Issue

```bash
# Example: Test Windows grep issue
node setup.js --security-config 2>&1 | grep "not recognized"
```

### Before Declaring "Fixed"

- [ ] **Search Verification**: Multiple search methods confirm target eliminated
- [ ] **Functional Test**: The reported error condition no longer occurs
- [ ] **Integration Test**: Full test suite passes
- [ ] **Documentation**: Update/add tests to prevent regression

**Example Checklist for Cross-Platform Compatibility**:

```bash
# 1. Verify no platform-specific commands (grep, find, etc.)
grep -r "| grep" . --exclude-dir=node_modules
grep -r "| find" . --exclude-dir=node_modules

# 2. Test the exact failing command
node setup.js --security-config

# 3. Verify functionality still works
# (e.g., ESLint security detection actually runs)
```

## Never Accept "It Should Work" - Always Verify

**❌ Bad**: "I removed the grep, so it should work on Windows now"

**✅ Good**: "I verified zero grep usage remains (3 search methods), tested the command, and confirmed ESLint security detection still functions"

## Common Patterns

### Dependency Injection for Testability

**Pattern**:

```javascript
// lib/validation/validation-factory.js
class ValidationFactory {
  createValidator(type, options = {}) {
    const mergedOptions = { ...this.globalOptions, ...options }

    switch (type) {
      case 'security':
        return new ConfigSecurityScanner(mergedOptions)
      // ...
    }
  }
}
```

**Why**: Allows injecting test doubles, mocking filesystem, controlling behavior.

### Error Handling with User-Friendly Messages

**Pattern**:

```javascript
try {
  const packageJson = JSON.parse(fs.readFileSync(path, 'utf8'))
} catch (error) {
  console.error(`❌ Error parsing package.json: ${error.message}`)
  console.log('\nPlease fix the JSON syntax and try again.')
  console.log('Common issues: trailing commas, missing quotes\n')
  process.exit(1)
}
```

**Why**: Guides users to resolution instead of cryptic stack traces.

### Template Validation Before Mutations

**Pattern**:

```javascript
// Validate BEFORE any mutations
if (customTemplatePath) {
  if (!fs.existsSync(customTemplatePath)) {
    console.error(`❌ Template path does not exist: ${customTemplatePath}`)
    process.exit(1)
  }
}

// Now safe to mutate
copyTemplateFiles(customTemplatePath, targetPath)
```

**Why**: Prevents partial state if validation fails mid-operation.

## Release Process

### Version Bump Workflow

```bash
# 1. Run full test suite
npm run prerelease

# 2. Check coverage meets thresholds
npm run test:coverage

# 3. Review RELEASE_CHECKLIST.md
cat .github/RELEASE_CHECKLIST.md

# 4. Update version and tag
npm run release:patch  # or :minor or :major

# 5. GitHub Actions handles npm publish
```

### Post-Mortem After Critical Bugs

**When**: Any production-blocking bug (P0/P1)

**Process**:

1. Create `claudedocs/[BUG-ID]-POST-MORTEM.md`
2. Document root cause analysis
3. Identify prevention strategies
4. Update this CONTRIBUTING.md with lessons learned
5. Add tests to prevent regression

**Example**: `claudedocs/PREMIUM-002-POST-MORTEM.md` after v3.0.0 bugs

## Questions?

For project-specific questions, see `CLAUDE.md` for development notes.

## Legal

- [Privacy Policy](https://buildproven.ai/privacy-policy)
- [Terms of Service](https://buildproven.ai/terms)

---

> **Vibe Build Lab LLC (d/b/a BuildProven)** · [buildproven.ai](https://buildproven.ai)
