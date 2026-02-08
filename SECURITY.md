# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **security@buildproven.ai**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We will work with you to understand and address the issue.

## Security Practices

### What We Do

- **Dependency Scanning**: Regular `npm audit` and automated security updates
- **Secret Detection**: CI/CLI secret scans (gitleaks/`npm run security:secrets`) to block hardcoded secrets
- **Code Review**: All changes reviewed before merge
- **Environment Variables**: Secrets stored in environment variables, never in code

### What We Don't Store

- Passwords in plaintext
- API keys in source code
- Sensitive data in logs

## Supported Versions

Security updates are provided for the latest version of the CLI tool.

## Security Updates

Security patches are released as soon as possible after discovery. Subscribe to GitHub releases to be notified.

## Responsible Disclosure

We follow responsible disclosure practices:

1. Reporter contacts us privately
2. We acknowledge within 48 hours
3. We investigate and develop a fix
4. We release the fix
5. We publicly disclose after patch is available

## Legal

- [Privacy Policy](https://buildproven.ai/privacy-policy)
- [Terms of Service](https://buildproven.ai/terms)

---

> **Vibe Build Lab LLC (d/b/a BuildProven)** · [buildproven.ai](https://buildproven.ai)
