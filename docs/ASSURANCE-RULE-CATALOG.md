# QA Architect assurance rule catalog

Rule pack: `2.1.0`

This catalog is generated from the shipped Semgrep rule files. It describes supported static checks, not a claim of complete application security.

## Limitations

- Rules detect only the documented static patterns in supported languages.
- A clean scan does not prove the absence of vulnerabilities.
- Authorization, runtime configuration, and data isolation may require runtime evidence or human review.

## Next.js SaaS assurance pack

Pack contract: `web-saas@1.2.0`

Stack detection selects only checks applicable to declared dependencies or recognized repository markers. Runtime checks remain explicit evidence requirements; they are not silently treated as passing static analysis.

- This pack measures only the documented static patterns and named runtime evidence requirements.
- A clean result does not certify framework security, authorization, tenant isolation, or payment correctness.
- Row-level security, cache isolation, webhook replay resistance, and deployed configuration require runtime evidence.

| Check                                | Evidence      | Stacks           | Rule version | Guidance                                                                                   | Verification                                                                              | Limitation                                                                                                                                                                                                                            |
| ------------------------------------ | ------------- | ---------------- | ------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client-public-secret`               | deterministic | nextjs, stripe   | 1.0.0        | Read STRIPE_SECRET_KEY only in server code.                                                | Inspect the built client bundle and confirm the secret value is absent.                   | Name-based detection cannot identify a secret with a benign variable name.                                                                                                                                                            |
| `next-client-privileged-client`      | deterministic | nextjs, supabase | 1.0.0        | Construct privileged clients in a server-only module or route.                             | Build the app and inspect client chunks for the privileged credential.                    | Aliased constructors or credentials hidden behind helper calls may not match.                                                                                                                                                         |
| `next-route-auth`                    | heuristic     | nextjs           | 1.0.0        | Resolve and validate the caller session before the mutation.                               | Exercise the route unauthenticated and as a second user; both must be denied.             | Project-specific auth wrappers and intentionally public routes require review.                                                                                                                                                        |
| `next-untrusted-redirect`            | deterministic | nextjs           | 1.0.0        | Map an allowlisted destination key to a local path.                                        | Supply an external URL and confirm the response cannot redirect off-site.                 | Data-flow through helper functions may not be detected.                                                                                                                                                                               |
| `next-auth-cache-isolation`          | runtime       | nextjs           | 1.0.0        | Include authorization scope in the cache key or opt sensitive reads out of shared caching. | Probe the same cached route as two users and two tenants after revalidation.              | Cache isolation cannot be established from source syntax alone.                                                                                                                                                                       |
| `supabase-privileged-client`         | heuristic     | supabase         | 1.0.0        | Isolate the service-role client in a server-only admin module with caller checks.          | Trace every caller and confirm no untrusted request can select arbitrary rows.            | A privileged client can be valid; this rule identifies a mandatory review point.                                                                                                                                                      |
| `supabase-cross-tenant-read`         | heuristic     | supabase         | 1.0.0        | Use authenticated-user scope and verified RLS policies.                                    | Read the row as a second user and confirm the database denies it.                         | Static analysis cannot inspect deployed RLS policies.                                                                                                                                                                                 |
| `supabase-rls-isolation`             | runtime       | supabase         | 1.0.0        | Enable RLS and define least-privilege owner or tenant policies.                            | Run two-user read and mutation probes against the deployed database.                      | Local source files do not prove the policies deployed to the target database.                                                                                                                                                         |
| `prisma-tenant-scope`                | heuristic     | prisma           | 1.0.0        | Include userId, ownerId, tenantId, organizationId, or accountId in the query.              | Attempt the operation using another user's object ID.                                     | Authorization enforced before the query may make a finding safe.                                                                                                                                                                      |
| `prisma-mass-assignment`             | deterministic | prisma           | 1.0.0        | Parse an allowlisted input schema and construct mutation data explicitly.                  | Submit an authorization-sensitive field and confirm it is rejected.                       | Aliases and helper-mediated request data may evade direct matching.                                                                                                                                                                   |
| `drizzle-tenant-scope`               | heuristic     | drizzle          | 1.0.0        | Combine ID and authenticated ownership predicates with and().                              | Attempt the operation using another user's object ID.                                     | The current rule recognizes direct request expressions, not arbitrary data flow.                                                                                                                                                      |
| `drizzle-mass-assignment`            | deterministic | drizzle          | 1.0.0        | Parse an allowlisted input schema and set explicit fields.                                 | Submit an authorization-sensitive field and confirm it is rejected.                       | Aliases and helper-mediated request data may evade direct matching.                                                                                                                                                                   |
| `orm-destructive-migration`          | deterministic | prisma, drizzle  | 1.1.0        | Use an expand-migrate-contract sequence with backup and rollback evidence.                 | Apply the migration to a production-like snapshot and verify preserved data and rollback. | A matched destructive operation may be intentional but remains release-sensitive. This rule covers DROP TABLE, DROP COLUMN, and TRUNCATE in recognized migration paths; it does not classify every possible data-rewriting statement. |
| `stripe-webhook-signature`           | heuristic     | stripe           | 1.2.0        | stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)                          | Replay a payload with an invalid signature and confirm rejection before side effects.     | Custom verification wrappers may require a waiver after review. The heuristic is limited to recognized Next.js Stripe webhook route paths and direct request-body parsing.                                                            |
| `stripe-idempotency-replay`          | runtime       | stripe           | 1.0.0        | Persist the event ID transactionally before applying an idempotent side effect.            | Deliver the same signed event twice concurrently and compare durable outcomes.            | Replay resistance depends on durable state and transaction behavior.                                                                                                                                                                  |
| `stripe-server-authoritative-amount` | deterministic | stripe           | 1.0.0        | Resolve an allowlisted server-side price or product record.                                | Tamper with the client amount or price ID and confirm the server ignores or rejects it.   | Data flow through intermediate helpers may not be detected.                                                                                                                                                                           |
| `stripe-customer-ownership`          | heuristic     | stripe           | 1.0.0        | Load the customer ID from the authenticated user's server-side account record.             | Supply another user's customer ID and confirm denial before the Stripe call.              | Upstream ownership checks may make a direct call safe.                                                                                                                                                                                |

## Rules

| Rule ID                                     | Version | Severity | Languages              | CWE      | OWASP    | Source                             |
| ------------------------------------------- | ------- | -------- | ---------------------- | -------- | -------- | ---------------------------------- |
| `auth-bypass-or-condition`                  | 1.0.0   | medium   | javascript, typescript | CWE-287  | —        | `.semgrep/defensive-patterns.yaml` |
| `auth-skip-on-dev`                          | 1.0.0   | medium   | javascript, typescript | CWE-287  | —        | `.semgrep/defensive-patterns.yaml` |
| `bracket-notation-user-key`                 | 1.0.0   | medium   | javascript, typescript | CWE-1321 | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `client-side-auth-check`                    | 1.0.0   | high     | javascript, typescript | CWE-602  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `command-injection-shell-option`            | 1.0.0   | critical | javascript, typescript | CWE-78   | —        | `.semgrep/defensive-patterns.yaml` |
| `command-injection-template`                | 1.0.0   | critical | javascript, typescript | CWE-78   | A03:2021 | `.semgrep/defensive-patterns.yaml` |
| `console-log-credential`                    | 1.0.0   | medium   | javascript, typescript | CWE-532  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `cookie-no-httponly`                        | 1.0.0   | medium   | javascript, typescript | CWE-1004 | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `cors-allow-all`                            | 1.0.0   | medium   | javascript, typescript | CWE-942  | —        | `.semgrep/defensive-patterns.yaml` |
| `debug-flag-hardcoded`                      | 1.0.0   | medium   | javascript, typescript | CWE-489  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `destructive-database-migration`            | 1.1.0   | high     | generic                | CWE-732  | A04:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `drizzle-request-body-mass-assignment`      | 1.0.0   | high     | javascript, typescript | CWE-915  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `drizzle-where-eq-id-unscoped`              | 1.0.0   | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `dynamic-href-user-input`                   | 1.0.0   | medium   | javascript, typescript | CWE-79   | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `dynamic-html-assignment`                   | 1.0.0   | high     | javascript, typescript | CWE-79   | A03:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `dynamic-require-variable`                  | 1.0.0   | high     | javascript, typescript | CWE-706  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `env-var-in-client-component`               | 1.0.0   | medium   | javascript, typescript | CWE-526  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `express-no-helmet`                         | 1.2.0   | medium   | javascript, typescript | CWE-693  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `file-upload-unchecked`                     | 1.0.0   | medium   | javascript, typescript | CWE-434  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `hardcoded-admin-identity`                  | 1.0.0   | critical | javascript, typescript | CWE-798  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `hardcoded-api-key`                         | 1.0.0   | critical | javascript, typescript | CWE-798  | —        | `.semgrep/defensive-patterns.yaml` |
| `hardcoded-jwt-secret`                      | 1.0.0   | critical | javascript, typescript | CWE-798  | —        | `.semgrep/defensive-patterns.yaml` |
| `hardcoded-live-secret-literal`             | 1.0.0   | critical | javascript, typescript | CWE-798  | A02:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `idor-prisma-no-owner-filter`               | 1.0.0   | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `insecure-random-array`                     | 1.0.0   | medium   | javascript, typescript | CWE-330  | —        | `.semgrep/defensive-patterns.yaml` |
| `insecure-random-token`                     | 1.0.0   | high     | javascript, typescript | CWE-330  | —        | `.semgrep/defensive-patterns.yaml` |
| `jwt-no-expiry`                             | 1.0.0   | high     | javascript, typescript | CWE-613  | —        | `.semgrep/vibe-audit-rules.yaml`   |
| `missing-auth-api-route`                    | 1.0.0   | medium   | javascript, typescript | CWE-306  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `next-route-handler-missing-auth`           | 1.0.0   | medium   | javascript, typescript | CWE-862  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `next-untrusted-redirect`                   | 1.0.0   | high     | javascript, typescript | CWE-601  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `path-traversal-join`                       | 1.0.0   | medium   | javascript, typescript | CWE-22   | —        | `.semgrep/defensive-patterns.yaml` |
| `path-traversal-resolve`                    | 1.0.0   | medium   | javascript, typescript | CWE-22   | —        | `.semgrep/defensive-patterns.yaml` |
| `prisma-find-by-request-id-unscoped`        | 1.0.0   | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `prisma-request-body-mass-assignment`       | 1.0.0   | high     | javascript, typescript | CWE-915  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `prototype-pollution-json-parse`            | 1.0.0   | high     | javascript, typescript | CWE-1321 | A03:2021 | `.semgrep/defensive-patterns.yaml` |
| `prototype-pollution-object-assign`         | 1.0.0   | medium   | javascript, typescript | CWE-1321 | —        | `.semgrep/defensive-patterns.yaml` |
| `prototype-pollution-spread`                | 1.0.0   | medium   | javascript, typescript | CWE-1321 | —        | `.semgrep/defensive-patterns.yaml` |
| `public-env-holds-secret`                   | 1.0.0   | high     | javascript, typescript | CWE-200  | A02:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `react-dangerous-html`                      | 1.0.0   | high     | javascript, typescript | CWE-79   | A07:2021 | `.semgrep/defensive-patterns.yaml` |
| `react-href-javascript`                     | 1.0.0   | high     | javascript, typescript | CWE-79   | —        | `.semgrep/defensive-patterns.yaml` |
| `service-key-in-client-component`           | 1.0.0   | high     | javascript, typescript | CWE-200  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `sql-injection-string-concat`               | 1.0.0   | critical | javascript, typescript | CWE-89   | —        | `.semgrep/defensive-patterns.yaml` |
| `sql-injection-template-string`             | 1.0.0   | critical | javascript, typescript | CWE-89   | A03:2021 | `.semgrep/defensive-patterns.yaml` |
| `stripe-request-controlled-amount`          | 1.0.0   | high     | javascript, typescript | CWE-602  | A04:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `stripe-request-customer-without-ownership` | 1.0.0   | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `stripe-webhook-json-without-signature`     | 1.2.0   | medium   | javascript, typescript | CWE-345  | A08:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `supabase-select-on-user-table`             | 1.0.0   | critical | javascript, typescript | CWE-639  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `supabase-service-role-client`              | 1.0.0   | medium   | javascript, typescript | CWE-250  | A01:2021 | `.semgrep/vibe-moat-rules.yaml`    |
| `unbounded-array-growth`                    | 1.0.0   | medium   | javascript, typescript | CWE-400  | —        | `.semgrep/defensive-patterns.yaml` |
| `unsafe-eval`                               | 1.0.0   | critical | javascript, typescript | CWE-95   | —        | `.semgrep/defensive-patterns.yaml` |
| `unvalidated-redirect`                      | 1.0.0   | medium   | javascript, typescript | CWE-601  | A01:2021 | `.semgrep/vibe-audit-rules.yaml`   |
| `verbose-error-to-client`                   | 1.1.0   | medium   | javascript, typescript | CWE-209  | A05:2021 | `.semgrep/vibe-audit-rules.yaml`   |
