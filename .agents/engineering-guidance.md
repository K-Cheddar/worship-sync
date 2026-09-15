# Engineering Guidance and Lessons Policy

Use durable guidance to prevent costly recurring mistakes. This is not a journal of every bug, review comment, or local preference.

These are starting points, not automatic promotion rules. Require evidence of recurrence or sufficiently high impact before growing permanent guidance, except when one incident reveals a critical invariant.

| Finding class | Default response |
| --- | --- |
| One-off defect | Fix locally; do not create permanent guidance by default. |
| Recurring judgment problem | Consider skill or pattern guidance. |
| Mechanically detectable problem | Prefer lint, type, test, or CI enforcement. |
| Missing reusable concept | Consider a shared abstraction. |
| Domain invariant | Encode it in the relevant domain skill and, where possible, tests. |
| Global engineering expectation | Consider an AGENTS.md rule. |

Before adding prose guidance, prefer stronger enforcement in this order:

1. Type system
2. Test
3. Lint or static check
4. Shared abstraction
5. AGENTS.md global rule
6. Domain skill or pattern documentation

Choose enforcement for the nature of the lesson; do not accumulate one-off review comments as permanent rules. Keep global guidance concise and put deeper, domain-specific invariants in the relevant skill.

## Guidance ownership

Every repository-local skill or guidance file referenced by tracked agent instructions must also be versioned in the repository.

Repository-authored skills under `.agents/skills/` are canonical and versioned. This repository does not use `.claude/skills/` adapters for repository-authored skills: a portable adapter that does not duplicate content has not been verified. Consumers must load the canonical files through their own supported skill-discovery mechanism; do not assume cross-agent discovery without verifying it.

## CI follow-up

At the time of this assessment, `.github/workflows/checks.yml` invokes root `npm run checks`. That path runs server tests, client coverage, and client lint, but it does not invoke client `type-check` or `build:strict`.

Recommended follow-up: once the current tree is verified clean, add an explicit client TypeScript check and client build gate (for example, `type-check` plus `build:strict`, or an equivalent non-duplicative combination) to the required CI path. Do not treat `build:strict` as TypeScript checking; its current script runs lint plus a Vite build.

## Future work

`react-quality` is the canonical, evidence-based skill for substantive React and TypeScript work. Expand it only from recurring WorshipSync findings and verified repository examples; do not add broad React guidance speculatively.
