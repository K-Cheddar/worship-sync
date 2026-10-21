# Unified My Schedule continuation guide

Work on `in-progress`; preserve unrelated edits and commits. Do not merge `in-progress-2`, deploy, send production messages or enable the dispatcher.

Read AGENTS.md, applicable repository skills, the [confirmed contract](features/volunteer-my-schedule.md), [implementation plan](volunteer-portal-plan.md) and [review](volunteer-portal-review.md).

The owner resolved prior renewal/recovery questions: reuse valid links; never extend on reads; verify independently proven unique possession after expiry; automatically issue fresh access after verification. Revocation blocks recovery until explicit restore. Codes last ten minutes with five guesses, a 60-second cooldown and durable hourly limits of five/contact/member, 20/IP and 200/church.

Maintain one renderer and trusted-identity operation boundary. Preserve human sessions/CSRF, signed-in capabilities, legacy limited links, publication privacy, consent and approval/uncertainty fences. Recheck authority at transaction commit. Never exchange a limited response token for portal authority.

Use actual demo Firestore and built HTTPS browser coverage. Mock delivery; do not substitute in-memory tests for transaction evidence. Operational activation remains off by default.
