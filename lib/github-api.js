/**
 * GitHub API Integration for QA Architect
 * Enables Dependabot alerts and security features via GitHub API
 */

const https = require('https')
const { execSync } = require('child_process')

// TD5 fix: Simple rate limiter for GitHub API
// GitHub allows 5000 requests/hour for authenticated requests
const rateLimiter = {
  tokens: 100, // Start with 100 tokens
  maxTokens: 100,
  refillRate: 100 / 3600, // Refill ~100 tokens per hour
  lastRefill: Date.now(),
  minDelayMs: 100, // Minimum delay between requests

  async acquire() {
    try {
      // Refill tokens based on time elapsed
      const now = Date.now()
      const elapsed = (now - this.lastRefill) / 1000
      const refilled = elapsed * this.refillRate

      // DR5 fix: Validate math to prevent NaN/Infinity
      if (!Number.isFinite(refilled) || refilled < 0) {
        console.warn('⚠️  Rate limiter math error, resetting')
        this.tokens = this.maxTokens
        this.lastRefill = now
        return
      }

      this.tokens = Math.min(this.maxTokens, this.tokens + refilled)
      this.lastRefill = now

      // If we have tokens, use one
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }

      // Wait before allowing request
      const waitTime = Math.max(
        this.minDelayMs,
        ((1 - this.tokens) / this.refillRate) * 1000
      )

      // DR5 fix: Validate waitTime before setTimeout
      if (!Number.isFinite(waitTime) || waitTime < 0 || waitTime > 60000) {
        console.warn(
          `⚠️  Rate limiter computed invalid wait time: ${waitTime}ms, using minimum`
        )
        await new Promise(resolve => setTimeout(resolve, this.minDelayMs))
      } else {
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      this.tokens = 0
    } catch (error) {
      // DR5 fix: Don't block on rate limiter errors, just log and proceed
      console.error(`❌ Rate limiter error: ${error.message}`)
    }
  },
}

/**
 * Get GitHub token from environment or gh CLI
 */
function getGitHubToken() {
  // Check environment variable first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }

  // Try to get from gh CLI (hardcoded command - no injection risk)
  try {
    const token = execSync('gh auth token', { encoding: 'utf8' }).trim()
    if (token) return token
  } catch (error) {
    // Silent failure fix: Log unexpected errors for debugging
    // ENOENT = gh not installed (expected), other errors should be visible in DEBUG mode
    if (
      error?.code !== 'ENOENT' &&
      !error?.message?.includes('command not found')
    ) {
      if (process.env.DEBUG) {
        console.warn(`⚠️  gh auth token failed: ${error.message}`)
      }
    }
  }

  return null
}

/**
 * Get repository info from git remote
 * Uses hardcoded git command - no injection risk
 */
function getRepoInfo(projectPath = '.') {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: projectPath,
      encoding: 'utf8',
    }).trim()

    // Parse GitHub URL (https or ssh format)
    const httpsMatch = remoteUrl.match(
      /github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/
    )
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] }
    }

    return null
  } catch (error) {
    // Silent failure fix: Log unexpected errors for debugging
    // "No such remote" is expected when origin isn't configured
    if (
      !error?.stderr?.includes('No such remote') &&
      error?.code !== 'ENOENT'
    ) {
      if (process.env.DEBUG) {
        console.warn(`⚠️  git remote get-url failed: ${error.message}`)
      }
    }
    return null
  }
}

/**
 * Sanitize error messages to remove sensitive tokens
 * DR29 fix: Prevent token exposure in error messages
 */
function sanitizeError(error, token) {
  // Not an access check: `token` is the secret to redact from `error`; this
  // returns the error unchanged when there is nothing to sanitize. No access
  // is granted here.
  // nosemgrep: semgrep.auth-bypass-or-condition
  if (!error || !token) return error

  const message = error.message || String(error)
  // Use string replace with global flag instead of RegExp to avoid security warning
  const sanitized = message.split(token).join('***REDACTED***')

  if (error instanceof Error) {
    const sanitizedError = new Error(sanitized)
    sanitizedError.stack = error.stack?.split(token).join('***REDACTED***')
    return sanitizedError
  }

  return new Error(sanitized)
}

/**
 * Make GitHub API request with rate limiting
 * TD5 fix: Added rate limiting to prevent hitting GitHub's API limits
 * DR29 fix: Sanitize errors to prevent token exposure
 */
async function githubRequest(method, path, token, data = null) {
  // TD5 fix: Acquire rate limit token before making request
  await rateLimiter.acquire()

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'qa-architect',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }

    if (data) {
      options.headers['Content-Type'] = 'application/json'
    }

    const req = https.request(options, res => {
      let body = ''
      res.on('data', chunk => (body += chunk))
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // DR12 fix: Handle JSON parse errors gracefully
          try {
            const data = body ? JSON.parse(body) : null
            resolve({ status: res.statusCode, data })
          } catch {
            // DR29 fix: Sanitize error before rejecting
            reject(
              sanitizeError(
                new Error(
                  `GitHub API returned invalid JSON (status ${res.statusCode}): ${body.slice(0, 100)}`
                ),
                token
              )
            )
          }
        } else if (res.statusCode === 204) {
          resolve({ status: 204, data: null })
        } else {
          // DR12 fix: GitHub errors are usually JSON, but handle parse failures
          let errorBody = body || res.statusMessage
          try {
            const errorData = JSON.parse(body)
            errorBody = errorData.message || errorBody
          } catch {
            // Use raw body if JSON parse fails
          }

          // DR29 fix: Sanitize error before rejecting
          reject(
            sanitizeError(
              new Error(`GitHub API error: ${res.statusCode} - ${errorBody}`),
              token
            )
          )
        }
      })
    })

    // DR29 fix: Sanitize network errors
    req.on('error', error => reject(sanitizeError(error, token)))

    if (data) {
      req.write(JSON.stringify(data))
    }
    req.end()
  })
}

/**
 * Check if Dependabot alerts are enabled
 */
async function checkDependabotStatus(owner, repo, token) {
  try {
    await githubRequest(
      'GET',
      `/repos/${owner}/${repo}/vulnerability-alerts`,
      token
    )
    return true // 204 means enabled
  } catch (error) {
    if (error.message.includes('404')) {
      return false // Not enabled
    }
    throw error
  }
}

/**
 * Enable Dependabot alerts for a repository
 */
async function enableDependabotAlerts(owner, repo, token) {
  try {
    await githubRequest(
      'PUT',
      `/repos/${owner}/${repo}/vulnerability-alerts`,
      token
    )
    return { success: true, message: 'Dependabot alerts enabled' }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

/**
 * Enable Dependabot security updates
 */
async function enableDependabotSecurityUpdates(owner, repo, token) {
  try {
    await githubRequest(
      'PUT',
      `/repos/${owner}/${repo}/automated-security-fixes`,
      token
    )
    return { success: true, message: 'Dependabot security updates enabled' }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

/**
 * Full setup: Enable all Dependabot features
 */
async function setupDependabot(projectPath = '.', options = {}) {
  const { verbose = false } = options
  const results = {
    success: false,
    repoInfo: null,
    alerts: null,
    securityUpdates: null,
    errors: [],
  }

  // Get token
  const token = getGitHubToken()
  if (!token) {
    results.errors.push(
      'No GitHub token found. Set GITHUB_TOKEN env var or run `gh auth login`'
    )
    return results
  }

  // Get repo info
  const repoInfo = getRepoInfo(projectPath)
  if (!repoInfo) {
    results.errors.push('Could not determine GitHub repository from git remote')
    return results
  }
  results.repoInfo = repoInfo

  if (verbose) {
    console.log(`📦 Repository: ${repoInfo.owner}/${repoInfo.repo}`)
  }

  // Check current status
  try {
    const isEnabled = await checkDependabotStatus(
      repoInfo.owner,
      repoInfo.repo,
      token
    )
    if (isEnabled) {
      if (verbose) console.log('✅ Dependabot alerts already enabled')
      results.alerts = { success: true, message: 'Already enabled' }
    } else {
      // Enable alerts
      results.alerts = await enableDependabotAlerts(
        repoInfo.owner,
        repoInfo.repo,
        token
      )
      if (verbose) {
        console.log(
          results.alerts.success
            ? '✅ Dependabot alerts enabled'
            : `❌ Failed to enable alerts: ${results.alerts.message}`
        )
      }
    }
  } catch (error) {
    results.errors.push(`Alerts check failed: ${error.message}`)
  }

  // Enable security updates
  try {
    results.securityUpdates = await enableDependabotSecurityUpdates(
      repoInfo.owner,
      repoInfo.repo,
      token
    )
    if (verbose) {
      console.log(
        results.securityUpdates.success
          ? '✅ Dependabot security updates enabled'
          : `⚠️ Security updates: ${results.securityUpdates.message}`
      )
    }
  } catch (error) {
    results.errors.push(`Security updates failed: ${error.message}`)
  }

  results.success = results.alerts?.success && results.errors.length === 0

  return results
}

module.exports = {
  getGitHubToken,
  getRepoInfo,
  checkDependabotStatus,
  enableDependabotAlerts,
  enableDependabotSecurityUpdates,
  setupDependabot,
}
