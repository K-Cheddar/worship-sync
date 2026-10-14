# Feature Contract: [Feature name]

**Contract status:** [Confirmed product intent / Draft — needs product-owner review / Mixed; identify each section]

**Approval source:** [Current request or explicit product-owner decision, with date/link. Use “None — draft only” if unapproved.]

**Last reviewed:** [Date]

## Purpose

Why does this feature exist for WorshipSync operators? Describe the real-world problem it solves.

## Operator workflow

Describe how operators use it before, during, and after a service as relevant. Mark unverified details as draft.

## Expected behavior

State confirmed behaviors users can rely on. Include explicit actions, automatic behavior, and relationships to other features. Attach an approval source to consequential product decisions.

## Behavioral boundaries

State what the feature must not do and what using it should leave unaffected. Separate confirmed boundaries from proposed ones.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow |  |  |  |
| Repeated or explicit action |  |  |  |
| Manual change |  |  |  |
| Missing, incomplete, or unavailable data |  |  |  |
| Error or recovery |  |  |  |
| Other important edge case |  |  |  |

## Product decisions

For each consequential decision, record:

- **Question/problem:**
- **Approved behavior:**
- **Why:**
- **Material alternative rejected:**
- **Approval source/date:**
- **Affected workflow/contract:**

Do not label an unresolved question as approved. Do not treat implementation, tests, or an agent-authored note as an approval source.

## Implementation references

Link the user entry point, relevant implementation, and focused regression tests. These references describe where behavior currently lives; they do not independently establish product intent.

- Entry point:
- Implementation:
- Tests:

## Technical design notes (separate from product requirements)

Record only design details useful to maintainers. Keep code structure, state ownership, persistence, and synchronization choices out of product guarantees unless the product owner has explicitly made them part of the user-visible contract.
