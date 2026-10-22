# Aggregate test commands

Run these commands from the repository root:

| Command | Includes |
| --- | --- |
| `npm run test:quick` | The existing `npm run checks` pipeline: server tests, client Jest tests, ESLint, and TypeScript checking. It does not run browser E2E suites. |
| `npm run test:e2e:all` | The three authenticated Playwright suites and every standalone client browser suite listed below. It runs E2E only. |
| `npm run test:all` | Quick checks followed by all E2E suites, even if the quick checks fail. |

The aggregates run sequentially. A failed suite does not stop later suites. Each attempted suite has a status and duration in the final report. Failed and skipped suites are listed at the end. The process exits unsuccessfully if a check or suite fails, or if a required suite cannot run because a prerequisite is missing.

## E2E inventory and individual commands

`test:e2e:all` runs these suites once each, in this order:

| Suite | Individual command |
| --- | --- |
| Smoke / navigation | `npm run test:e2e:smoke` |
| Scheduling workflows | `npm run test:e2e:scheduling` |
| Presentation Controller | `npm run test:e2e:controller` |
| Account responsive navigation | `npm run test:e2e:responsive-navigation --prefix client` |
| Home launcher | `npm run test:e2e:home-launcher --prefix client` |
| Home navigation | `npm run test:e2e:home-navigation --prefix client` |
| Mobile board controller | `npm run test:e2e:board-controller-mobile --prefix client` |
| Mobile modal behavior | `npm run test:e2e:modal-mobile-focus --prefix client` |
| Scheduling quick-member workflow | `npm run test:e2e:schedule-quick-member --prefix client` |
| My Schedule cards | `npm run test:e2e:my-schedule-cards --prefix client` |
| Service-plan refresh | `npm run test:e2e:service-plan-refresh --prefix client` |
| Availability workspace | `npm run test:e2e:availability-workspace --prefix client` |
| Resources responsive | `npm run test:e2e:resources-responsive --prefix client` |
| Teams responsive navigation | `npm run test:e2e:teams-responsive-navigation --prefix client` |
| Teams responsive-navigation smoke | `npm run test:e2e:responsive-navigation:smoke --prefix client` |
| Schedules performance | `npm run test:e2e:schedules-performance --prefix client` |

The existing `npm run test:e2e:browser --prefix client` remains available and still runs only Account responsive navigation and mobile board controller. The aggregate invokes those two individually so it does not duplicate them. `run-browser-suite.mjs`, Playwright setup, and fixture-management or policy scripts are utilities or safeguards, not independent browser suites.

## Prerequisites

- Install dependencies at the repository root and in `client/`, and install Playwright Chromium. See [client browser test setup](../../client/e2e/README.md).
- Use the repository Node version from `.nvmrc` (Node 24); the existing focused client browser checks explicitly require Node 24.
- `test:quick` needs the same environment as `npm run checks`.
- Authenticated suites require a running local renderer/API at a valid `E2E_BASE_URL`, `E2E_TEST_EMAIL`, and the existing saved browser state at `playwright/.auth/worshipsync-user.json`. The aggregate checks that Chromium can launch, the configured target responds, and the saved state is present before those suites run. It does not start a server or deployment.
- The built-in church identity is `demo`; `E2E_DEMO_CHURCH_ID` is not required. If the deprecated variable is supplied, it must equal `demo`; smoke and scheduling are skipped if it names another church.
- Scheduling additionally needs the existing Firebase Admin configuration (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `FIREBASE_DATABASE_URL`). The scheduling fixture itself verifies the authenticated account's `demo` identity and edit permission on the reserved test team before fixture writes. Missing credentials skip only that suite; the runner does not create a church or grant access.
- Client browser suites use their local browser fixtures and need the ports each fixture reserves to be free. The aggregate executes them one at a time.

## Authentication and fixture safety

Before authenticated suites, the runner executes `npm run test:e2e:auth:validate`, which selects only Playwright's existing `setup` project. That code validates and safely reuses the saved session, including its existing silent recovery path. If validation fails or needs an email code, the authenticated suites are reported as skipped with a prerequisite failure. No password sign-in, verification email, MailSlurp request, or SMS/invitation/notification is attempted. The aggregate excludes both `test:e2e:auth` and the explicit `test:e2e:auth:refresh` workflow. The authenticated Playwright projects keep their own setup dependencies and browser safety guards.

Scheduling and Presentation Controller continue using their existing ownership markers and `finally` cleanup. Cleanup failures fail the suite and are included in its log. A hard process interruption may bypass `finally`; inspect the manifest under `playwright/.fixtures/` and use the existing inventory tools before any manual recovery. The aggregate never performs cleanup recovery or removes ambiguous records.

## Results and troubleshooting

The console report shows every E2E suite, including suites skipped by preflight, with `PASS`, `FAIL`, or `SKIPPED` and its duration. It prints failed suites and skipped suites separately at the end. Detailed, credential-redacted logs for each aggregate run and its `summary.json` are saved under `test-results/aggregate/<run-id>/`. The existing Playwright HTML report remains available through `npm run test:e2e:report`; it represents the latest Playwright invocation, while aggregate logs retain output from all suites.

If a suite fails, review its log and the suite's existing fixture diagnostics. Later suites still run. Scheduling permission and fixture checks remain inside the scheduling fixture, and cleanup errors are never treated as passes.
