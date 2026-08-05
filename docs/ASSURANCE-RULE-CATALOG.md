# QA Architect assurance rule catalog

Rule pack: `1.0.0`

This catalog is generated from the shipped Semgrep rule files. It describes supported static checks, not a claim of complete application security.

## Limitations

- Rules detect only the documented static patterns in supported languages.
- A clean scan does not prove the absence of vulnerabilities.
- Authorization, runtime configuration, and data isolation may require runtime evidence or human review.

## Rules

| Rule ID                              | Severity | Languages              | CWE      | OWASP    | Source                             |
| ------------------------------------ | -------- | ---------------------- | -------- | -------- | ---------------------------------- |
| `auth-bypass-or-condition`           | medium   | javascript, typescript | CWE-287  | —        | `.semgrep/defensive-patterns.yaml` |
| `auth-skip-on-dev`                   | medium   | javascript, typescript | CWE-287  | —        | `.semgrep/defensive-patterns.yaml` |
| `bracket-notation-user-key`          | medium   | javascript, typescript | CWE-1321 | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `client-side-auth-check`             | high     | javascript, typescript | CWE-602  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `command-injection-shell-option`     | critical | javascript, typescript | CWE-78   | —        | `.semgrep/defensive-patterns.yaml` |
| `command-injection-template`         | critical | javascript, typescript | CWE-78   | A03:2021 | `.semgrep/defensive-patterns.yaml` |
| `console-log-credential`             | medium   | javascript, typescript | CWE-532  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `cookie-no-httponly`                 | medium   | javascript, typescript | CWE-1004 | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `cors-allow-all`                     | medium   | javascript, typescript | CWE-942  | —        | `.semgrep/defensive-patterns.yaml` |
| `debug-flag-hardcoded`               | medium   | javascript, typescript | CWE-489  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `drizzle-where-eq-id-unscoped`       | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `dynamic-href-user-input`            | medium   | javascript, typescript | CWE-79   | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `dynamic-html-assignment`            | high     | javascript, typescript | CWE-79   | A03:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `dynamic-require-variable`           | high     | javascript, typescript | CWE-706  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `env-var-in-client-component`        | medium   | javascript, typescript | CWE-526  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `express-no-helmet`                  | medium   | javascript, typescript | CWE-693  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `file-upload-unchecked`              | medium   | javascript, typescript | CWE-434  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `hardcoded-admin-identity`           | critical | javascript, typescript | CWE-798  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `hardcoded-api-key`                  | critical | javascript, typescript | CWE-798  | —        | `.semgrep/defensive-patterns.yaml` |
| `hardcoded-jwt-secret`               | critical | javascript, typescript | CWE-798  | —        | `.semgrep/defensive-patterns.yaml` |
| `hardcoded-live-secret-literal`      | critical | javascript, typescript | CWE-798  | A02:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `idor-prisma-no-owner-filter`        | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `insecure-random-array`              | medium   | javascript, typescript | CWE-330  | —        | `.semgrep/defensive-patterns.yaml` |
| `insecure-random-token`              | high     | javascript, typescript | CWE-330  | —        | `.semgrep/defensive-patterns.yaml` |
| `jwt-no-expiry`                      | high     | javascript, typescript | CWE-613  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `missing-auth-api-route`             | medium   | javascript, typescript | CWE-306  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `path-traversal-join`                | medium   | javascript, typescript | CWE-22   | —        | `.semgrep/defensive-patterns.yaml` |
| `path-traversal-resolve`             | medium   | javascript, typescript | CWE-22   | —        | `.semgrep/defensive-patterns.yaml` |
| `prisma-find-by-request-id-unscoped` | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `prototype-pollution-json-parse`     | high     | javascript, typescript | CWE-1321 | A03:2021 | `.semgrep/defensive-patterns.yaml` |
| `prototype-pollution-object-assign`  | medium   | javascript, typescript | CWE-1321 | —        | `.semgrep/defensive-patterns.yaml` |
| `prototype-pollution-spread`         | medium   | javascript, typescript | CWE-1321 | —        | `.semgrep/defensive-patterns.yaml` |
| `public-env-holds-secret`            | high     | javascript, typescript | CWE-200  | A02:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `react-dangerous-html`               | high     | javascript, typescript | CWE-79   | A07:2021 | `.semgrep/defensive-patterns.yaml` |
| `react-href-javascript`              | high     | javascript, typescript | CWE-79   | —        | `.semgrep/defensive-patterns.yaml` |
| `service-key-in-client-component`    | high     | javascript, typescript | CWE-200  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `sql-injection-string-concat`        | critical | javascript, typescript | CWE-89   | —        | `.semgrep/defensive-patterns.yaml` |
| `sql-injection-template-string`      | critical | javascript, typescript | CWE-89   | A03:2021 | `.semgrep/defensive-patterns.yaml` |
| `supabase-select-on-user-table`      | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `unbounded-array-growth`             | medium   | javascript, typescript | CWE-400  | —        | `.semgrep/defensive-patterns.yaml` |
| `unsafe-eval`                        | critical | javascript, typescript | CWE-95   | —        | `.semgrep/defensive-patterns.yaml` |
| `unvalidated-redirect`               | medium   | javascript, typescript | CWE-601  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `verbose-error-to-client`            | medium   | javascript, typescript | CWE-209  | A05:2021 | `.semgrep/vibe-audit-rules.yaml`   |
