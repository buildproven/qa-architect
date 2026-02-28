# GitHub Actions Cost Analysis

**Updated**: 2026-02-03
**Budget**: 2,000 mins/month (GitHub Free tier)

---

## Current Status: Within Budget (with fixes)

### Actual January 2026 Usage (vibebuildlab org)

| Repo                    | Minutes    | Runs  | Avg/Run |
| ----------------------- | ---------- | ----- | ------- |
| qa-architect            | 340        | 349   | 1.0 min |
| postrail                | 1,769      | 295   | 6.0 min |
| vibebuildlab            | 89         | 282   | 0.3 min |
| keyflash                | 74         | 187   | 0.4 min |
| wfhroulette             | 56         | 138   | 0.4 min |
| jobrecon                | 56         | 44    | 1.3 min |
| buildproven             | 4          | 33    | 0.1 min |
| vibebuildlab-newsletter | 1          | 22    | 0.0 min |
| **TOTAL**               | **~2,400** | 1,350 | 1.8 min |

### February Projection (Pre-Fix)

Based on Feb 1-3 data extrapolated:

- **Projected**: 3,425 mins/month
- **Budget**: 2,000 mins/month
- **Overage**: 71%

### Root Cause: Dependabot PR Spam

| Repo         | Dependabot % of Runs |
| ------------ | -------------------- |
| jobrecon     | 91%                  |
| postrail     | 63%                  |
| keyflash     | 53%                  |
| qa-architect | 8%                   |
| vibebuildlab | 0%                   |

---

## Fixes Applied (v5.11.2)

### 1. Skip Quality Checks for Dependabot PRs

```yaml
detect-maturity:
  if: github.actor != 'dependabot[bot]' || github.event_name == 'schedule'
```

**Savings**: ~50% reduction in runs (~1,400 mins/month)

### 2. Minimal Workflow Mode (v5.11.1)

- Security scans: Weekly only (not every push)
- Test matrix: Node 22 only (not [20, 22])
- Path filters: Skip docs-only changes
- Concurrency: Cancel in-progress runs

### Expected February Usage (Post-Fix)

| Metric             | Before | After        | Savings |
| ------------------ | ------ | ------------ | ------- |
| Minutes/Month      | 3,425  | ~1,200-1,500 | 55-65%  |
| Budget Utilization | 171%   | 60-75%       | ✅      |

---

## Workflow Tiers

qa-architect supports three workflow modes:

| Mode                  | When to Use             | Estimated Cost |
| --------------------- | ----------------------- | -------------- |
| **Minimal** (default) | Solo dev, private repos | ~$0-10/mo      |
| **Standard**          | Team projects, PRs      | ~$10-30/mo     |
| **Comprehensive**     | Enterprise, compliance  | ~$50-100/mo    |

### Minimal Mode (Default)

- Single Node.js version (22)
- Security scans monthly only
- Path filters enabled
- Skip Dependabot PRs
- Concurrency limits

### Standard Mode (`--workflow-standard`)

- Matrix on main only (20, 22)
- Security on manual/monthly schedule
- Full test coverage

### Comprehensive Mode (`--workflow-comprehensive`)

- Matrix every commit
- Inline security scans
- E2E tests on every PR

---

## Optimization Tips

1. **Make repos public** → Unlimited free minutes
2. **Group Dependabot updates** → Fewer PRs/week
3. **Use path filters** → Skip docs-only changes
4. **Disable CI on inactive repos** → Zero cost

---

## Commands

```bash
# Check workflow mode
npx create-qa-architect --check-maturity

# Analyze CI costs
npx create-qa-architect --analyze-ci

# Switch to minimal mode
npx create-qa-architect --workflow-minimal --force
```
