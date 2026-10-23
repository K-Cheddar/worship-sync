# Schedules performance browser check

From the repository root, `npm run test:e2e:all` includes all authenticated Playwright and standalone client browser suites, including this performance check. See [aggregate test commands](../../docs/testing/aggregate-test-commands.md) for the complete inventory and reporting behavior.

## Focused responsive browser suites

From `client/`, run either suite with `npm run test:e2e:responsive-navigation` or `npm run test:e2e:board-controller-mobile`; run both sequentially with `npm run test:e2e:browser`. These checks use the existing root Playwright dependency and require Node.js 24, dependencies installed with `npm ci` at the repository root and `npm ci --prefix client`, plus the Playwright Chromium browser. Install Chromium with `npx playwright install chromium` (Linux CI also needs `--with-deps`). The suites start local Vite fixtures on ports 3108 and 3112, use synthetic data, and do not require a live church or credentials. Keep those ports free while the checks run.

GitHub Actions runs them through the separate **Focused Client Browser Checks** workflow, where you can choose one suite or both. It installs Chromium and its Linux libraries and has a 15-minute job timeout. Both suites took about 28 seconds locally with dependencies and Chromium already installed; allow about 5–10 minutes for a fresh Ubuntu CI run, mostly for dependency and browser setup. The CI duration is an estimate. Normal pull request checks and local agent validation gain no browser setup or execution time.

From `client/`, run `node e2e/schedules-performance.mjs` with Playwright and Chromium available. Set `PLAYWRIGHT_MODULE_PATH` to an existing Playwright package when it is not installed in this checkout. The runner uses a deterministic fixture (52 generated occurrences, 260 saved occurrences with 260 assignment rows, 20 members, UTC), blocks remote requests, and profiles the real Teams shell and `ScheduleTab` in Chromium. It reports first and repeat visits, browser long tasks, React Profiler commits, CDP CPU samples, module-resource timings, and a rapid switch away while the real lazy section module is held pending. It starts and stops a local Vite server on port 3113, then builds and previews the same fixture in production mode on port 3114 using an ignored cache directory under `node_modules`.


# Isolated smoke navigation regressions

From `client/`, run `node e2e/responsive-navigation.mjs --smoke`. This uses the real Teams editor, scheduling page, shared smoke assertions, and synthetic church/team/service data on localhost. It checks a view-only first team followed by an editable team, an empty next period, restoration of controls, and rejection of error text as an empty state. API responses are local fixtures; no saved authentication or live church is used. The authenticated suite still requires the disposable-church prerequisites in `docs/testing/smoke-coverage.md`.

# Service-plan refresh scroll regression

From `client/`, run `npm run test:e2e:service-plan-refresh`. It mounts the real `FloatingWindow` and `ControllerServicePlanView` with a local long-plan fixture in Chromium, then verifies native scroll anchoring and expanded-note continuity after an insertion above the reading position, plus a nearby reading position after deleting the visible item. The check needs the existing root Playwright dependency and Chromium, and requires no church account or authentication.
