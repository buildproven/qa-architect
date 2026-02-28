# GitHub Actions Workflow Policy

## ⚠️ CRITICAL: Do Not Create Additional Workflows

This project uses **qa-architect** for quality automation with **minimal workflow mode** (budget-first: <1000 min/month target).

### What This Means for AI Assistants (Claude, Copilot, etc.)

**❌ DO NOT:**

- Create new workflow files (`.github/workflows/*.yml`)
- Add jobs to existing `quality.yml` workflow
- Suggest "comprehensive" CI improvements
- Add matrix builds, nightly runs, or scheduled jobs
- Create duplicate workflows (e.g., `ci.yml` alongside `quality.yml`)

**✅ INSTEAD:**

- Use existing `quality.yml` workflow (managed by qa-architect)
- Update via: `npx create-qa-architect@latest --update --workflow-minimal`
- For feature-specific needs, use quality.yml's maturity detection
- Consult user before any CI changes

### Current Configuration

- **Mode:** Minimal (~$0-5/mo per project)
- **Path filters:** Skip docs/config changes (60% fewer runs)
- **Security:** Monthly schedule (not every commit)
- **Node version:** Single version (22)

### Why This Matters

- **Cost control:** Prevents $20-350/mo per-project bloat
- **Efficiency:** Path filters + monthly security = 60-90% CI savings
- **Standards:** Consistent automation across all projects

### Upgrading CI (User Decision Only)

If comprehensive CI is truly needed:

```bash
# User must explicitly approve and run:
npx create-qa-architect@latest --update --workflow-standard      # ~$5-20/mo
npx create-qa-architect@latest --update --workflow-comprehensive # ~$100-350/mo
```

**Bottom line:** AI should optimize code, not expand CI infrastructure.
