#!/bin/bash
# Rollout v5.8.0 with minimal workflow mode to all projects
# This prevents workflow bloat by defaulting to cost-efficient CI

set -e  # Exit on error

echo "════════════════════════════════════════════════════════"
echo "QA Architect v5.8.0 Rollout - Minimal Workflow Mode"
echo "════════════════════════════════════════════════════════"
echo ""

# Projects to UPDATE (already have qa-architect)
EXISTING_PROJECTS=(
  "ai-learning-companion"
  "brettstark-about"
  "brettstark"
  "jobrecon"
  "keyflash"
  "postrail"
  "retireabroad"
  "stark-program-intelligence"
  "buildproven"
)

# Projects to INSTALL (don't have qa-architect yet)
NEW_PROJECTS=(
  "ai-prompt-library"
  "wfhroulette"
)

# Skip these (already on v5.8.0 or have minimal mode)
# - qa-architect (this repo)
# - project-starter-guide (already has minimal mode)

SUCCESS_COUNT=0
FAIL_COUNT=0
FAILED_PROJECTS=()

# Function to update existing project
update_project() {
  local project=$1
  echo "=== Updating $project ==="

  if [ ! -d ~/Projects/$project ]; then
    echo "⚠️  Directory not found: ~/Projects/$project"
    echo ""
    return 1
  fi

  cd ~/Projects/$project

  # Update to latest with minimal workflow mode (bypass license checks)
  if QAA_DEVELOPER=true npx create-qa-architect@latest --update --workflow-minimal; then
    # Verify workflow mode
    if grep -q "# WORKFLOW_MODE: minimal" .github/workflows/quality.yml 2>/dev/null; then
      echo "✅ $project: Updated successfully with minimal mode"
      ((SUCCESS_COUNT++))
    else
      echo "❌ $project: Failed to apply minimal mode (marker missing)"
      ((FAIL_COUNT++))
      FAILED_PROJECTS+=("$project")
    fi
  else
    echo "❌ $project: qa-architect setup failed"
    ((FAIL_COUNT++))
    FAILED_PROJECTS+=("$project")
  fi

  echo ""
}

# Function to install in new project
install_project() {
  local project=$1
  echo "=== Installing qa-architect in $project ==="

  if [ ! -d ~/Projects/$project ]; then
    echo "⚠️  Directory not found: ~/Projects/$project"
    echo ""
    return 1
  fi

  cd ~/Projects/$project

  # Fresh install or update with minimal workflow mode (bypass license checks)
  if QAA_DEVELOPER=true npx create-qa-architect@latest --update --workflow-minimal; then
    if grep -q "# WORKFLOW_MODE: minimal" .github/workflows/quality.yml 2>/dev/null; then
      echo "✅ $project: Installed successfully with minimal mode"
      ((SUCCESS_COUNT++))
    else
      echo "❌ $project: Failed to apply minimal mode (marker missing)"
      ((FAIL_COUNT++))
      FAILED_PROJECTS+=("$project")
    fi
  else
    echo "❌ $project: qa-architect setup failed"
    ((FAIL_COUNT++))
    FAILED_PROJECTS+=("$project")
  fi

  echo ""
}

# Update existing projects
echo "📦 Phase 1: Updating ${#EXISTING_PROJECTS[@]} existing projects"
echo "════════════════════════════════════════════════════════"
echo ""

for project in "${EXISTING_PROJECTS[@]}"; do
  update_project "$project"
done

echo ""
echo "📦 Phase 2: Installing in ${#NEW_PROJECTS[@]} new projects"
echo "════════════════════════════════════════════════════════"
echo ""

for project in "${NEW_PROJECTS[@]}"; do
  install_project "$project"
done

# Summary
echo ""
echo "════════════════════════════════════════════════════════"
echo "Rollout Complete"
echo "════════════════════════════════════════════════════════"
echo ""
echo "✅ Success: $SUCCESS_COUNT projects"
echo "❌ Failed:  $FAIL_COUNT projects"

if [ $FAIL_COUNT -gt 0 ]; then
  echo ""
  echo "Failed projects:"
  for project in "${FAILED_PROJECTS[@]}"; do
    echo "  - $project"
  done
  exit 1
fi

echo ""
echo "Next steps:"
echo "1. Review changes in each project"
echo "2. Commit and push workflow updates"
echo "3. Monitor GitHub Actions usage for 1 week"
echo "4. Expected: 60-90% reduction in CI minutes"
