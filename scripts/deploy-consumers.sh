#!/usr/bin/env bash
set -euo pipefail

# Prepare narrow QA Architect rollout changes without writing to consumer
# checkouts or default branches. The default mode validates and reports. --pr
# creates one feature branch and pull request per selected consumer.

PROJECTS_DIRS=(
  "$HOME/Projects"
  "$HOME/Projects/internal"
  "$HOME/Projects/products"
  "$HOME/Projects/personal"
)
QA_ARCHITECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QA_VERSION="$(node -p "require('$QA_ARCHITECT_DIR/package.json').version")"
ROLLOUT_FILES=(
  ".github/workflows/quality.yml"
  ".buildproven/test-impact.json"
)

CREATE_PRS=false
CANARY_REPO=""
CANARY_ONLY=false
SKIP_CANARY=false
VERBOSE=false
TIER=""
ACTIVE_ROLLOUT_ROOT=""

usage() {
  cat <<'EOF'
Usage: deploy-consumers.sh [OPTIONS]

OPTIONS:
  --canary <repo>   Required canary consumer unless --skip-canary is explicit
  --canary-only     Process only the selected canary
  --skip-canary     Process all consumers without a canary gate
  --pr              Create feature branches and pull requests
  --tier <tier>     Override each consumer's current workflow tier
  --verbose         Show generator output and discarded setup changes
  --help, -h        Show this help

The default is a non-mutating validation. Rollout PRs contain only:
  .github/workflows/quality.yml
  .buildproven/test-impact.json

Direct default-branch push is not supported.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --canary) CANARY_REPO="${2:-}"; shift 2 ;;
    --canary-only) CANARY_ONLY=true; shift ;;
    --skip-canary) SKIP_CANARY=true; shift ;;
    --pr) CREATE_PRS=true; shift ;;
    --push)
      echo "ERROR: --push was removed; use --pr and normal branch protection." >&2
      exit 2
      ;;
    --tier) TIER="${2:-}"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$SKIP_CANARY" = false ] && [ -z "$CANARY_REPO" ]; then
  echo "ERROR: select a canary with --canary <repo>, or explicitly use --skip-canary." >&2
  exit 2
fi
if [ "$SKIP_CANARY" = true ] && [ "$CANARY_ONLY" = true ]; then
  echo "ERROR: --skip-canary and --canary-only cannot be combined." >&2
  exit 2
fi

cleanup_rollout_root() {
  local rollout_root="$1"
  case "$rollout_root" in
    */qa-consumer-rollout.*) find "$rollout_root" -depth -delete ;;
    *)
      echo "ERROR: refused unsafe rollout cleanup path: $rollout_root" >&2
      return 1
      ;;
  esac
}

cleanup_active_rollout_root() {
  [ -n "$ACTIVE_ROLLOUT_ROOT" ] || return 0
  local rollout_root="$ACTIVE_ROLLOUT_ROOT"
  ACTIVE_ROLLOUT_ROOT=""
  cleanup_rollout_root "$rollout_root"
}

trap 'cleanup_active_rollout_root || true' EXIT
trap 'cleanup_active_rollout_root || true; exit 130' INT TERM

canonical_primary_checkout() {
  local repo_dir="$1" git_dir common_dir
  git_dir="$(git -C "$repo_dir" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
  common_dir="$(git -C "$repo_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ]
}

declare -A SEEN_ORIGINS
CONSUMERS=()
CANARY_DIR=""
for projects_dir in "${PROJECTS_DIRS[@]}"; do
  [ -d "$projects_dir" ] || continue
  for workflow in "$projects_dir"/*/.github/workflows/quality.yml; do
    [ -f "$workflow" ] || continue
    repo_dir="$(dirname "$(dirname "$(dirname "$workflow")")")"
    repo_name="$(basename "$repo_dir")"
    case "$repo_name" in qa-architect|qa-architect-*) continue ;; esac
    canonical_primary_checkout "$repo_dir" || continue
    grep -q 'WORKFLOW_MODE:' "$workflow" 2>/dev/null || continue
    origin_url="$(git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
    [ -n "$origin_url" ] || continue
    [ -z "${SEEN_ORIGINS[$origin_url]:-}" ] || continue
    SEEN_ORIGINS[$origin_url]="$repo_dir"
    if [ -n "$CANARY_REPO" ] && [ "$repo_name" = "$CANARY_REPO" ]; then
      CANARY_DIR="$repo_dir"
    else
      CONSUMERS+=("$repo_dir")
    fi
  done
done

if [ "$SKIP_CANARY" = false ] && [ -z "$CANARY_DIR" ]; then
  echo "ERROR: canary '$CANARY_REPO' is not a canonical generated consumer." >&2
  exit 1
fi

echo "=== QA Architect $QA_VERSION consumer rollout ==="
echo "Mode: $([ "$CREATE_PRS" = true ] && echo 'CREATE PRS' || echo 'VALIDATE')"
if [ "$SKIP_CANARY" = true ]; then
  echo "Canary: explicitly skipped"
else
  echo "Canary: $CANARY_REPO"
fi

validate_writable_paths() {
  local repo_root="$1" relative current component
  for relative in "${ROLLOUT_FILES[@]}"; do
    current="$repo_root"
    IFS='/' read -r -a components <<< "$relative"
    for component in "${components[@]}"; do
      current="$current/$component"
      if [ -L "$current" ]; then
        echo "  SOURCE DEFECT: rollout path contains a symlink: $relative"
        return 1
      fi
      [ -e "$current" ] || break
    done
  done
}

default_branch_for() {
  git -C "$1" ls-remote --symref origin HEAD 2>/dev/null \
    | sed -n 's|^ref: refs/heads/\([^[:space:]]*\)[[:space:]]*HEAD$|\1|p'
}

repo_slug_for() {
  printf '%s\n' "$1" \
    | sed -E 's|\.git$||' \
    | sed -E 's|^.*[:/]([^/]+/[^/]+)$|\1|'
}

generate_rollout() {
  local source_dir="$1" is_canary="${2:-false}"
  local repo_name origin_url default_branch rollout_root target_dir existing_tier
  repo_name="$(basename "$source_dir")"
  origin_url="$(git -C "$source_dir" remote get-url origin)"
  default_branch="$(default_branch_for "$source_dir")"
  echo "--- $repo_name $([ "$is_canary" = true ] && echo '(CANARY)' || true) ---"

  if [ -z "$default_branch" ]; then
    echo "  SOURCE DEFECT: origin has no resolvable default branch"
    return 1
  fi

  rollout_root="$(mktemp -d -t qa-consumer-rollout.XXXXXX)"
  ACTIVE_ROLLOUT_ROOT="$rollout_root"
  target_dir="$rollout_root/repo"
  if ! git clone --quiet --single-branch --branch "$default_branch" "$origin_url" "$target_dir"; then
    echo "  SOURCE DEFECT: could not clone origin/$default_branch"
    cleanup_active_rollout_root || true
    return 1
  fi
  if ! validate_writable_paths "$target_dir"; then
    cleanup_active_rollout_root || true
    return 1
  fi
  if [ ! -f "$target_dir/package.json" ]; then
    echo "  SOURCE DEFECT: no package.json"
    cleanup_active_rollout_root || true
    return 1
  fi

  existing_tier="minimal"
  if grep -q 'WORKFLOW_MODE: standard' "$target_dir/.github/workflows/quality.yml"; then
    existing_tier="standard"
  elif grep -q 'WORKFLOW_MODE: comprehensive' "$target_dir/.github/workflows/quality.yml"; then
    existing_tier="comprehensive"
  fi
  [ -z "$TIER" ] || existing_tier="$TIER"

  echo "  Generating isolated $existing_tier workflow and test policy..."
  local generation_log="$rollout_root/generation.log"
  if ! (cd "$target_dir" && NODE_ENV=test QAA_DEVELOPER=true \
    node "$QA_ARCHITECT_DIR/setup.js" --update "--workflow-$existing_tier") \
    >"$generation_log" 2>&1; then
    echo "  GENERATOR FAILURE: workflow update failed"
    [ "$VERBOSE" = false ] || sed 's/^/    /' "$generation_log"
    cleanup_active_rollout_root || true
    return 1
  fi

  local policy_mode="--write-test-impact"
  [ ! -f "$target_dir/.buildproven/test-impact.json" ] || policy_mode="--update-test-impact"
  if ! (cd "$target_dir" && NODE_ENV=test QAA_DEVELOPER=true \
    node "$QA_ARCHITECT_DIR/setup.js" "$policy_mode") >>"$generation_log" 2>&1; then
    echo "  GENERATOR FAILURE: test-impact policy requires reviewed mappings"
    [ "$VERBOSE" = false ] || sed 's/^/    /' "$generation_log"
    cleanup_active_rollout_root || true
    return 1
  fi

  if ! node -e "require('$QA_ARCHITECT_DIR/node_modules/js-yaml').load(require('fs').readFileSync(process.argv[1], 'utf8'))" \
    "$target_dir/.github/workflows/quality.yml"; then
    echo "  GENERATOR FAILURE: generated workflow is invalid YAML"
    cleanup_active_rollout_root || true
    return 1
  fi
  if grep -qE 'create-qa-architect@latest|node_modules/create-qa-architect|semgrep/semgrep-action' \
    "$target_dir/.github/workflows/quality.yml"; then
    echo "  GENERATOR FAILURE: generated workflow contains a mutable or deprecated tool"
    cleanup_active_rollout_root || true
    return 1
  fi

  local intended_status discarded_status
  intended_status="$(git -C "$target_dir" status --short -- "${ROLLOUT_FILES[@]}")"
  discarded_status="$(git -C "$target_dir" status --short | grep -vE '^.. (\.github/workflows/quality\.yml|\.buildproven/test-impact\.json)$' || true)"
  if [ -z "$intended_status" ]; then
    echo "  CURRENT: no rollout change"
    cleanup_active_rollout_root || true
    return 2
  fi

  echo "  READY:"
  printf '%s\n' "$intended_status" | sed 's/^/    /'
  if [ "$VERBOSE" = true ] && [ -n "$discarded_status" ]; then
    echo "  Discarded unrelated setup output:"
    printf '%s\n' "$discarded_status" | sed 's/^/    /'
  fi

  if [ "$CREATE_PRS" = false ]; then
    cleanup_active_rollout_root || true
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "  PR FAILURE: gh CLI is required"
    cleanup_active_rollout_root || true
    return 1
  fi

  local branch="chore/qa-architect-${QA_VERSION//./-}"
  local slug
  slug="$(repo_slug_for "$origin_url")"
  if ! (
    cd "$target_dir"
    git checkout --quiet -b "$branch"
    git config user.name "QA Architect Rollout"
    git config user.email "qa-architect@users.noreply.github.com"
    git add "${ROLLOUT_FILES[@]}"
    local staged_file allowed expected_tree commit_sha remote_sha
    while IFS= read -r staged_file; do
      [ -n "$staged_file" ] || continue
      allowed=false
      for rollout_file in "${ROLLOUT_FILES[@]}"; do
        [ "$staged_file" != "$rollout_file" ] || allowed=true
      done
      if [ "$allowed" = false ]; then
        echo "  PR FAILURE: staged file escaped rollout boundary: $staged_file"
        exit 1
      fi
    done < <(git diff --cached --name-only)
    expected_tree="$(git write-tree)"
    git commit --quiet -m "chore: roll QA Architect $QA_VERSION"
    commit_sha="$(git rev-parse HEAD)"
    if [ "$(git rev-parse 'HEAD^{tree}')" != "$expected_tree" ]; then
      echo "  PR FAILURE: commit hooks changed the reviewed rollout tree"
      exit 1
    fi
    git push --quiet origin "HEAD:refs/heads/$branch"
    remote_sha="$(git ls-remote origin "refs/heads/$branch" | awk '{print $1}')"
    if [ "$remote_sha" != "$commit_sha" ]; then
      echo "  PR FAILURE: remote rollout branch does not match the prepared commit"
      exit 1
    fi
    gh pr create --repo "$slug" --base "$default_branch" --head "$branch" \
      --title "chore: roll QA Architect $QA_VERSION" \
      --body "Updates the generated risk-based quality workflow and affected-test policy from QA Architect $QA_VERSION.\n\nGenerated in an isolated clone; no local checkout or default branch was changed."
  ); then
    echo "  PR FAILURE: branch preparation, push, or PR creation failed"
    cleanup_active_rollout_root || true
    return 1
  fi
  cleanup_active_rollout_root || true
}

PASS=0
CURRENT=0
FAIL=0

run_one() {
  local repo_dir="$1" is_canary="${2:-false}" status
  if generate_rollout "$repo_dir" "$is_canary"; then
    PASS=$((PASS + 1))
  else
    status=$?
    if [ "$status" -eq 2 ]; then
      CURRENT=$((CURRENT + 1))
    else
      FAIL=$((FAIL + 1))
      return 1
    fi
  fi
}

if [ "$SKIP_CANARY" = false ]; then
  run_one "$CANARY_DIR" true || {
    echo "ROLLOUT STOPPED: canary preparation failed."
    exit 1
  }
  if [ "$CANARY_ONLY" = true ]; then
    echo "Summary: ready=$PASS current=$CURRENT failed=$FAIL"
    exit 0
  fi
  if [ "$CREATE_PRS" = true ]; then
    echo "CANARY PR CREATED: merge it through normal protection, then run with --skip-canary --pr."
    exit 0
  fi
fi

for repo_dir in "${CONSUMERS[@]}"; do
  run_one "$repo_dir" false || true
done

echo "Summary: ready=$PASS current=$CURRENT failed=$FAIL"
[ "$FAIL" -eq 0 ]
