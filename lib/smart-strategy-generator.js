/**
 * Smart Test Strategy Generator
 * Generates project-specific smart test strategy scripts
 * Premium feature (Pro tier)
 */

const fs = require('fs')
const path = require('path')

/**
 * Project type configurations with risk patterns and test commands
 */
const PROJECT_CONFIGS = {
  // CLI tools (like create-qa-architect)
  cli: {
    name: 'CLI Tool',
    highRiskRegex: 'setup\\.js|lib/.*|templates/.*|config/.*|bin/.*',
    testCommands: {
      // Command execution tests excluded from pre-push (run in CI only)
      comprehensive:
        'npm run test:medium 2>/dev/null || npm run test:fast 2>/dev/null || npm test',
      medium:
        'npm run test:medium 2>/dev/null || npm run test:fast 2>/dev/null || npm test',
      fast: 'npm run test:fast 2>/dev/null || npm run test:unit 2>/dev/null || npm test',
      minimal: 'npm run lint && npm run format:check',
    },
    detection: projectPath => {
      const pkg = readPackageJson(projectPath)
      return pkg?.bin || pkg?.scripts?.setup
    },
  },

  // Web applications (Next.js, React, Vue, etc.)
  webapp: {
    name: 'Web Application',
    highRiskRegex:
      'auth|payment|security|crypto|api/|pages/api/|app/api/|middleware',
    testCommands: {
      // E2E tests excluded from pre-push (run in CI only)
      comprehensive:
        'npm run test:medium 2>/dev/null || npm run test -- --testPathIgnorePatterns=e2e 2>/dev/null || npm test',
      medium:
        'npm run test:medium 2>/dev/null || npm run test -- --testPathIgnorePatterns=e2e',
      fast: 'npm run test:fast 2>/dev/null || npm run test -- --watch=false --coverage=false',
      minimal: 'npm run lint && npm run format:check',
    },
    detection: projectPath => {
      const pkg = readPackageJson(projectPath)
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
      return (
        deps?.next ||
        deps?.react ||
        deps?.vue ||
        deps?.['@angular/core'] ||
        deps?.svelte
      )
    },
  },

  // SaaS applications (payment, billing, auth heavy)
  saas: {
    name: 'SaaS Application',
    highRiskRegex:
      'auth|payment|billing|stripe|subscription|prisma/schema|middleware|webhook',
    testCommands: {
      // E2E tests excluded from pre-push (run in CI only)
      comprehensive:
        'npm run test:medium 2>/dev/null || (npm test && npm run security:audit 2>/dev/null)',
      medium: 'npm run test:medium 2>/dev/null || npm test',
      fast: 'npm run test:fast 2>/dev/null || npm run test:unit 2>/dev/null || npm test',
      minimal: 'npm run lint && npm run format:check',
    },
    detection: projectPath => {
      const pkg = readPackageJson(projectPath)
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
      return deps?.stripe || deps?.['@stripe/stripe-js'] || deps?.prisma
    },
  },

  // API services (Express, Fastify, etc.)
  api: {
    name: 'API Service',
    highRiskRegex: 'routes/|controllers/|middleware/|auth|security|database',
    testCommands: {
      // Slow integration tests excluded from pre-push (run in CI only)
      comprehensive:
        'npm run test:medium 2>/dev/null || npm run test:fast 2>/dev/null || npm test',
      medium:
        'npm run test:medium 2>/dev/null || npm run test -- --testPathIgnorePatterns=integration',
      fast: 'npm run test:fast 2>/dev/null || npm run test:unit 2>/dev/null || npm test',
      minimal: 'npm run lint && npm run format:check',
    },
    detection: projectPath => {
      const pkg = readPackageJson(projectPath)
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
      return (
        deps?.express ||
        deps?.fastify ||
        deps?.koa ||
        deps?.hapi ||
        deps?.restify
      )
    },
  },

  // Library/Package
  library: {
    name: 'Library/Package',
    highRiskRegex: 'src/|lib/|index\\.(js|ts)|package\\.json',
    testCommands: {
      comprehensive:
        'npm run test:comprehensive 2>/dev/null || (npm test && npm run build 2>/dev/null)',
      medium: 'npm run test:medium 2>/dev/null || npm test',
      fast: 'npm run test:fast 2>/dev/null || npm run test:unit 2>/dev/null || npm test',
      minimal: 'npm run lint && npm run format:check',
    },
    detection: projectPath => {
      const pkg = readPackageJson(projectPath)
      return pkg?.main || pkg?.module || pkg?.exports
    },
  },

  // Documentation project
  docs: {
    name: 'Documentation',
    highRiskRegex: 'guides/security|guides/deployment|setup-instructions',
    testCommands: {
      comprehensive:
        'npm run test:comprehensive 2>/dev/null || (npm run lint && npm run link:check 2>/dev/null)',
      medium:
        'npm run test:medium 2>/dev/null || npm run lint && npm run spell:check 2>/dev/null',
      fast: 'npm run test:fast 2>/dev/null || npm run lint',
      minimal: 'npm run lint 2>/dev/null || npx markdownlint "**/*.md"',
    },
    detection: projectPath => {
      const hasReadme = fs.existsSync(path.join(projectPath, 'README.md'))
      const hasDocs = fs.existsSync(path.join(projectPath, 'docs'))
      const pkg = readPackageJson(projectPath)
      return hasDocs && !pkg?.dependencies && hasReadme
    },
  },

  // Default fallback
  default: {
    name: 'General Project',
    highRiskRegex: 'src/|lib/|config/|package\\.json',
    testCommands: {
      comprehensive:
        'npm run test:comprehensive 2>/dev/null || npm test 2>/dev/null || echo "No test script found"',
      medium:
        'npm run test:medium 2>/dev/null || npm test 2>/dev/null || echo "No test script found"',
      fast: 'npm run test:fast 2>/dev/null || npm run test:unit 2>/dev/null || npm test 2>/dev/null || echo "No test script found"',
      minimal: 'npm run lint && npm run format:check',
    },
    detection: () => true, // Fallback always matches
  },
}

/**
 * Read package.json from project path
 * DR22 fix: Differentiate between missing file vs. read/parse errors
 */
function readPackageJson(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json')

  // File doesn't exist - expected for non-JS projects
  if (!fs.existsSync(pkgPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(pkgPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    // DR22 fix: Provide specific error messages for different failure types
    if (error instanceof SyntaxError) {
      const errorId = 'PKG_JSON_INVALID_SYNTAX'
      console.error(`❌ [${errorId}] package.json has invalid JSON syntax:`)
      console.error(`   File: ${pkgPath}`)
      console.error(`   Error: ${error.message}`)
      console.error(`\n   Recovery steps:`)
      console.error(`   1. Validate JSON: cat ${pkgPath} | jq .`)
      console.error(
        `   2. Common issues: trailing commas, missing quotes, unclosed brackets`
      )
      console.error(`   3. Use a JSON validator: https://jsonlint.com`)
      console.error(
        `\n   ⚠️  Smart Test Strategy will use generic fallback until this is fixed\n`
      )
    } else if (error.code === 'EACCES') {
      console.error(`❌ Permission denied reading package.json: ${pkgPath}`)
      console.error('   Check file permissions and try again')
    } else {
      console.error(
        `❌ Unexpected error reading package.json: ${error.message}`
      )
      if (process.env.DEBUG) {
        console.error(error.stack)
      }
    }
    return null
  }
}

/**
 * Detect project type based on dependencies and structure
 */
function detectProjectType(projectPath) {
  // Check each project type in priority order
  const typeOrder = ['saas', 'webapp', 'api', 'cli', 'library', 'docs']

  for (const type of typeOrder) {
    const config = PROJECT_CONFIGS[type]
    if (config.detection(projectPath)) {
      return type
    }
  }

  return 'default'
}

/**
 * Generate smart test strategy script for a project
 */
function generateSmartStrategy(options = {}) {
  const {
    projectPath = process.cwd(),
    projectName = path.basename(projectPath),
    projectType = null, // Auto-detect if not provided
    customHighRiskRegex = null,
    customTestCommands = null,
  } = options

  // Detect or use provided project type
  const detectedType = projectType || detectProjectType(projectPath)
  const config = PROJECT_CONFIGS[detectedType] || PROJECT_CONFIGS.default

  // Allow custom overrides
  const highRiskRegex = customHighRiskRegex || config.highRiskRegex
  const testCommands = { ...config.testCommands, ...customTestCommands }

  // Read template
  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    'scripts',
    'smart-test-strategy.sh'
  )

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Smart strategy template not found at ${templatePath}\n` +
        `This indicates a package installation issue.\n\n` +
        `Troubleshooting steps:\n` +
        `1. Reinstall the package: npm install -g create-qa-architect@latest\n` +
        `2. Check file permissions: ls -la ${path.dirname(templatePath)}\n` +
        `3. Report issue if problem persists: https://github.com/vibebuildlab/qa-architect/issues/new`
    )
  }

  let template = fs.readFileSync(templatePath, 'utf8')

  // Replace placeholders
  template = template.replace(/\{\{PROJECT_NAME\}\}/g, projectName)
  template = template.replace(/\{\{HIGH_RISK_REGEX\}\}/g, highRiskRegex)
  template = template.replace(
    /\{\{HIGH_RISK_PATTERN\}\}/g,
    `Project type: ${config.name}`
  )
  template = template.replace(
    /\{\{TEST_COMPREHENSIVE\}\}/g,
    testCommands.comprehensive
  )
  template = template.replace(/\{\{TEST_MEDIUM\}\}/g, testCommands.medium)
  template = template.replace(/\{\{TEST_FAST\}\}/g, testCommands.fast)
  template = template.replace(/\{\{TEST_MINIMAL\}\}/g, testCommands.minimal)
  template = template.replace(
    /\{\{COMPREHENSIVE_COMMAND\}\}/g,
    `Runs: ${testCommands.comprehensive}`
  )
  template = template.replace(
    /\{\{MEDIUM_COMMAND\}\}/g,
    `Runs: ${testCommands.medium}`
  )
  template = template.replace(
    /\{\{FAST_COMMAND\}\}/g,
    `Runs: ${testCommands.fast}`
  )
  template = template.replace(
    /\{\{MINIMAL_COMMAND\}\}/g,
    `Runs: ${testCommands.minimal}`
  )

  return {
    script: template,
    projectType: detectedType,
    projectTypeName: config.name,
    highRiskRegex,
    testCommands,
  }
}

/**
 * Write smart strategy script to project
 */
function writeSmartStrategy(projectPath, script) {
  const scriptsDir = path.join(projectPath, 'scripts')
  const scriptPath = path.join(scriptsDir, 'smart-test-strategy.sh')

  // Create scripts directory if needed
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true })
  }

  // Write script
  fs.writeFileSync(scriptPath, script)
  fs.chmodSync(scriptPath, 0o755)

  return scriptPath
}

/**
 * Generate pre-push hook that uses smart strategy
 */
function generateSmartPrePushHook() {
  return `echo "🔍 Running smart pre-push validation..."

# Check if smart test strategy script exists
if [ -f "scripts/smart-test-strategy.sh" ]; then
  bash scripts/smart-test-strategy.sh
else
  # Fallback to basic validation
  echo "📝 Linting..."
  npm run lint || {
    echo "❌ Lint failed! Fix errors before pushing."
    exit 1
  }

  echo "✨ Checking formatting..."
  npm run format:check || {
    echo "❌ Format check failed! Run 'npm run format' to fix."
    exit 1
  }

  # Run tests if they exist
  if node -e "const pkg=require('./package.json');process.exit(pkg.scripts.test?0:1)" 2>/dev/null; then
    echo "🧪 Running tests..."
    npm test || {
      echo "❌ Tests failed! Fix failing tests before pushing."
      exit 1
    }
  fi

  echo "✅ Pre-push validation passed!"
fi

# Security scans (runs after main validation)
echo ""
echo "🔐 Running security scans..."

# 1. Secret scanning with gitleaks
if command -v gitleaks &> /dev/null; then
  echo "  → Scanning for secrets..."
  gitleaks detect --no-git --verbose --exit-code=1 || {
    echo "❌ Secrets detected! Remove them before pushing."
    exit 1
  }
else
  echo "  ⚠️  gitleaks not installed - skipping secret scan"
  echo "     Install: brew install gitleaks (Mac) or npm install -g gitleaks"
fi

# 2. Dependency audit
echo "  → Checking dependencies..."
# Detect package manager and use appropriate audit command
if [ -f "pnpm-lock.yaml" ]; then
  pnpm audit --audit-level=high || {
    echo "❌ Vulnerable dependencies found! Run 'pnpm audit --fix' to resolve."
    exit 1
  }
elif [ -f "yarn.lock" ]; then
  yarn audit || {
    echo "❌ Vulnerable dependencies found! Run 'yarn audit fix' to resolve."
    exit 1
  }
else
  npm audit --audit-level=high || {
    echo "❌ Vulnerable dependencies found! Run 'npm audit fix' to resolve."
    exit 1
  }
fi

# 3. XSS pattern detection
echo "  → Scanning for XSS patterns..."
if grep -rE "innerHTML.*\\$\\{" src/ app/ lib/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" 2>/dev/null; then
  echo "❌ Potential XSS: innerHTML with interpolation found"
  exit 1
fi

if grep -rE "eval\\(.*\\$\\{" src/ app/ lib/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" 2>/dev/null; then
  echo "❌ Potential code injection: eval with interpolation found"
  exit 1
fi

echo "✅ Security scans passed!"
`
}

/**
 * Add test tier scripts to package.json
 */
function getTestTierScripts() {
  return {
    'test:fast': 'vitest run --reporter=basic --coverage=false',
    'test:medium':
      'vitest run --reporter=basic --testPathIgnorePatterns=e2e,integration',
    'test:comprehensive':
      'vitest run && npm run lint && npm run format:check && npm run security:audit 2>/dev/null || true',
    'test:smart': 'bash scripts/smart-test-strategy.sh',
  }
}

module.exports = {
  PROJECT_CONFIGS,
  detectProjectType,
  generateSmartStrategy,
  writeSmartStrategy,
  generateSmartPrePushHook,
  getTestTierScripts,
}
