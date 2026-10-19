# Unified volunteer My Schedule

Contract status: Confirmed product intent. Milestones A–D implemented behind an explicit activation gate.
Approval source: product-owner request, 2026-10-18, “Unified My Schedule for All Volunteers.”

## Product decisions

- Account and accountless volunteers use the same My Schedule renderer and volunteer business operations. The server resolves church/member scope from a human session or validated personal credential; request member IDs never establish identity.
- Both identities can read their current and previous assignments and own responses, respond individually, accept all unanswered, submit eligible availability, manage time off, see conflicts and teammate display names, read permitted service details, and use applicable self-service preferences. Preserve signed-in filters, navigation, exports, history and account capabilities.
- Private notes, teammate contacts/responses, administrative data and Draft assignments are excluded. Missing schedule publication metadata retains legacy Published semantics. Publication and notification delivery remain separate.
- Accept all unanswered checks persisted responses in each schedule transaction. Existing answers survive concurrent bulk acceptance. Multi-schedule outcomes identify committed schedules and failures; retry skips completed answers.
- Unsaved time-off drafts own their baseline dates and revision together. Refreshes, other successful actions and HTTP 409 cannot rebase a dirty draft. Conflicts preserve edits and require explicit review/discard before re-editing against current saved dates. Successful saves invalidate older page loads. Confirmed by the October 19, 2026 Final Correctness and Pilot Readiness request.
- Time-off revision, ownership and archive checks and the field-limited update must commit atomically. Concurrent unrelated administrative fields and archive state must survive. A later digest failure cannot turn a durable save into a failed mutation.
- Personal bearer credentials bind one church/member, expire after a configurable 90 days, are reused while valid, and never extend on reads. Replacement invalidates earlier credentials and sessions. Deliberate administrative revocation prevents verification-based restoration until authorized administrative restore.
- Valid personal access opens My Schedule. Authentic expired access offers explicit identity verification, then automatic fresh access. Recovery requires an independently verified uniquely mapped phone or verified unique email. Consent alone proves no identity; shared contacts cannot select a member. Unknown contacts receive generic responses. No eligible channel means administrator help.
- Browser portal sessions are isolated from human/admin sessions. Legacy 120-day schedule-response and limited availability tokens never acquire personal portal authority.
- Initial schedule SMS will contain church identification, a brief schedule-ready notification, one personal link and opt-out wording. Exact reviewed body/URL must match dispatch; changed/expired credentials require fresh review. Preserve explicit approval, consent, STOP, durable delivery identity and uncertainty fences. No automatic sends, reminders or production dispatcher activation.

## Recovery safeguards

Approved by the product owner in this conversation on 2026-10-18: 10-minute
single-use codes, five guesses, 60-second resend cooldown, at most five sends per
contact/member per hour, 20 per IP per hour, and 200 per church per hour. Enforce
these budgets durably. Existing unverified contacts remain ineligible until an
administrator establishes independent possession verification. Consent is not
possession proof; do not derive the latter from an administrative consent entry.

Duplicate-contact eligibility currently scans the church roster and normalizes
legacy phone formats before allowing recovery. Replacing that scan requires a
church-scoped contact index keyed by a keyed hash of the church, channel, and
normalized contact. A safe migration must dual-write the index on every contact,
archive, and church-membership change; backfill existing members; record collisions
instead of choosing one member; and audit index coverage before reads can rely
on it. Keep the roster scan as the authority until the backfill and every
contact writer are covered, then retain a fail-closed path for incomplete or
ambiguous index entries. Contact uniqueness must remain scoped to one church.

## Implementation record

See [implementation plan](../volunteer-portal-plan.md). Required milestones are
A shared core, B personal access/recovery, C shared UI, D compact messaging.
This contract records approved intent, not proof that those milestones have shipped.
