# React/TypeScript Enforcement Assessment

Audit date: 2026-09-13. This is an evidence-based assessment, not a lint-debt backlog.

| Candidate | Problem prevented | WorshipSync evidence | Compatibility / likely noise | Recommendation |
| --- | --- | --- | --- | --- |
| Existing `react-hooks` rules | Missing effect dependencies and unsafe hook structure | 18 `exhaustive-deps` suppressions exist; several documented identity/registration lifecycles are justified | Already compatible; suppressions retain necessary exceptions | ENABLE NOW (already enabled) |
| Existing Testing Library/Jest lint rules | Implementation-detail tests and conditional assertions | The effective client ESLint config enables `testing-library/no-node-access` and `jest/no-conditional-expect` as errors through the existing React/Jest configuration | Already compatible and enforced; do not add redundant configuration | KEEP — already enabled |
| Client TypeScript check in required CI | Type/interface drift at client boundaries | Strict `tsc --noEmit` reported 184 errors on 2026-09-13, including production nullability/preload mismatches and stale test fixtures | Not compatible until the current errors are resolved; enabling would fail all checks | ENABLE LATER |
| Type-aware ESLint (`no-floating-promises`, `no-misused-promises`, unsafe-any rules, unnecessary assertions) | Unhandled promise/error paths and unsafe boundary access | The client has many async effects/writes and substantial legacy `any`/assertion use | Requires parser project configuration and staged baselining; likely substantial current noise | ENABLE LATER |
| `@typescript-eslint/no-explicit-any` | New broad escape hatches | Legacy `any` use is concentrated around context and PouchDB interoperability boundaries | A hard rule would create cleanup scope before those boundaries are deliberately modeled | ENABLE LATER after boundary inventory |
| Import/cycle detection | Hidden dependency cycles | No recurring cycle failure found in the audit history | Unknown false-positive and configuration cost; no repository evidence of a problem | NOT USEFUL now |
| General effect/state/ownership rules | Derived-state effects, wrong state authority, stale remote behavior | Recent feature-follow-up fixes include stale video listeners, controller outline ownership, and multi-output sync wiring | Semantic/contextual; static rules cannot distinguish required lifecycles from bad effects reliably | KEEP JUDGMENT-BASED |
| Shared-write ordering | Lost updates, stale rollback, remote echo loops | Existing mutation skills and `store.ts` ordering/publication safeguards encode cross-device contracts | Requires data-store-specific semantics and test cases, not generic lint | KEEP JUDGMENT-BASED |

## Staged TypeScript adoption

Do not add `type-check` to `npm run checks` until the 184 current errors are triaged. Start with production interface/nullability errors and Electron preload/API declarations, then update deliberately stale test fixtures. Once `npm.cmd run type-check --prefix client` is clean, add that exact command to the root `checks` script and `.github/workflows/checks.yml` path in a small, dedicated change.
