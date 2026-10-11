# WorshipSync Feature Contracts

Feature Contracts describe what a WorshipSync feature is for, how operators use it, and which behaviors they can rely on. They help implementation planning and code review preserve the real workflow, especially where a technically reasonable safeguard could prevent an operator from doing something they intentionally chose.

Start with the [contract template](CONTRACT_TEMPLATE.md). The registry below is an inventory and documentation plan, not a source of unreviewed requirements.

## Evidence and status

Keep these kinds of statements visibly separate:

- **Confirmed product intent** — behavior explicitly specified in the current request or supported by a confirmed applicable contract or explicit previous product-owner decision. Cite the authorization source in the contract.
- **Draft / needs review** — a useful proposed description that has not been approved. It does not authorize implementation.
- **Current implementation** — what the code and tests do today. This is observational evidence only; it does not prove the intended behavior.
- **Known mismatch or open question** — a conflict or consequential choice that still needs a product-owner decision.

Do not mark agent-authored prose as confirmed merely because it is in this repository. Likewise, tests describe and enforce code expectations; they do not by themselves establish product approval. If a change to confirmed behavior is approved, update the contract and the regression tests that protect it in the same work.

## Feature inventory

All entries except Generate Credits are **inventory only**: their broad workflow labels below are observed from current product surfaces and need product-owner validation before being treated as behavioral contracts. Implementation references help locate the feature; they are not requirements.

The audit on `in-progress` found no existing Feature Contract set or documentation-specific branch. Existing `docs/` pages are focused architecture, migration, and rollout references; this registry complements them rather than replacing them.

| Feature area | Observed workflow (draft) | Related areas | Implementation starting points | Contract status | Priority |
| --- | --- | --- | --- | --- | --- |
| Live controllers and presentation | Prepare a service, select content, and present it across controller, projector, monitor, stream, and auxiliary outputs. | Service plans, overlays, media, timers, display settings | `client/src/pages/Controller/Controller.tsx`, `client/src/pages/Controller/CurrentServiceWorkspace.tsx`, `client/src/pages/AuxController/AuxController.tsx`, `client/src/components/DisplayWindow/` | Inventory only; intent review needed | P1 — live-service risk and many output surfaces |
| Overlays and credits | Prepare participant and other overlays, generate/edit credits, and present them during or after a service. | Live presentation, teams schedules, service plans | [Generate Credits contract](generate-credits.md), `client/src/pages/OverlayController/OverlayController.tsx`, `client/src/pages/CreditsEditor/CreditsEditor.tsx`, `client/src/containers/Overlays/` | Generate Credits contract: owner-confirmed workflow with open edge case; other overlay behavior is inventory only | P1 — explicit regression history and public presentation |
| Service plans and planning synchronization | Prepare a service outline, bring in outside planning information, review it, and use/publish it in controller and public views. | Live presentation, songs, assignments, public views | `client/src/pages/Services/`, `client/src/pages/Controller/ControllerServicePlanView.tsx`, `server/planningCenterPlanImport.js`, `client/src/pages/Services/useServicePlanOutlinePush.ts` | Inventory only; intent review needed | P1 — complex cross-source ownership and synchronization |
| Team schedules and availability | Maintain service schedules, respond to serving requests, and manage personal availability/blockouts. | Teams, messaging, credits, service plans | `client/src/pages/Teams/schedule/`, `client/src/pages/MySchedule.tsx`, `client/src/pages/MyScheduleBlockouts.tsx` | Inventory only; intent review needed | P1 — volunteer coordination and schedule changes affect service readiness |
| Teams, members, and access | Maintain teams, roles, positions, members, qualifications, forms, and access to team information. | Scheduling, notifications, administration | `client/src/pages/Teams/pages/`, `client/src/pages/Teams/TeamsAndServices.tsx`, `server/teamsAuthHandlers.js`, `client/src/api/auth.ts` | Inventory only; intent review needed | P1 — permissions and shared roster data |
| Media library, uploads, and preparation | Organize and upload service media, prepare it for playback, and use it in presentation. | Live presentation, service plans, storage | `client/src/containers/Media/`, `client/src/pages/ResourceUploadDialog.tsx`, `docs/media-library-v2-migration.md`, `docs/media-preparation-readiness-rtdb-rules.md` | Inventory only; intent review needed | P1 — live playback and durable media lifecycle |
| Messaging and notifications | Send serving requests and other team communications, then track responses and delivery/recovery state. | Team schedules, members, public responses | `client/src/pages/Teams/pages/TeamsMessagesPage.tsx`, `client/src/pages/Teams/schedule/ScheduleMessagesPanel.tsx`, `server/teamsAuthHandlers.js` | Inventory only; intent review needed | P1 — external communication and consequential retry/consent behavior |
| Public service and team views | Share service information, participant credits, team schedules, intake, and response pages with people outside the controller. | Plans, credits, schedules, permissions | `client/src/pages/ServicePublic.tsx`, `client/src/pages/ServicePublicView.tsx`, `client/src/pages/Teams/TeamSchedulePublic.tsx`, `server/servicePlanPublic.js` | Inventory only; intent review needed | P1 — public data visibility and access boundaries |
| Equipment and assignments | Assign people and equipment such as microphones to service-plan items or team schedule slots. | Service plans, team schedules, equipment inventory | `client/src/pages/Services/ServicePlanAssigneeList.tsx`, `client/src/pages/Teams/schedule/ScheduleEquipmentSelect.tsx`, `client/src/pages/Teams/pages/TeamsMicrophonesPage.tsx` | Inventory only; intent review needed | P2 — cross-feature assignment ownership and availability |
| Application settings and administration | Configure account, integrations, controller outputs, and church/team administration. | Live presentation, permissions, all configured features | `client/src/pages/Controller/AccountFormSections.tsx`, `client/src/pages/Controller/IntegrationsSettingsPanel.tsx`, `client/src/pages/Teams/pages/TeamsServiceSettingsPage.tsx`, `client/src/pages/Account/` | Inventory only; intent review needed | P2 — broad impact, but document alongside the workflows each setting controls |

## What to document next

Create a small number of contracts around complete operator workflows, not one contract per button or component. Recommended order:

1. Service plans and planning synchronization — document which plan/source is authoritative at each operator step, what import/push actions replace or preserve, and what controller/public surfaces consume.
2. Live controllers and presentation — document service-time operation, cross-output expectations, transitions, and recovery from unavailable media or disconnected outputs.
3. Media preparation and playback — document upload, preparation readiness, local/remote availability, and what an operator can safely expect at service time.
4. Team schedules and availability — document planning, volunteer response, substitutions, blockouts, and notifications as one connected workflow.
5. Public service/team views and permissions — document who can see which projection and how a link or response action changes access.
6. Messaging, equipment, and administration — add focused contracts once the connected workflows above establish their boundaries.

The inventory can be refined while those contracts are researched. Do not infer approval from its draft workflow descriptions.

## Lightweight maintenance

- Create a contract when a feature is high-risk, complex, used across multiple surfaces, or has caused disagreement or regression about operator intent. Small technical changes do not need a new contract.
- Before modifying a behavior, read the applicable contract. If none exists, investigate code, tests, adjacent workflows, and available product-owner context, then ask before making an unresolved consequential choice.
- Update a contract when approved product behavior changes, a meaningful boundary is clarified, or implementation references move enough to become misleading. Keep implementation observations separate from requirements.
- Record an important decision in the affected contract's **Product decisions** section: the question, approved behavior, reason, material rejected alternative, and approval source/date. Cross-link contracts when one decision spans workflows. Do not create records for routine engineering choices.
- Link regression tests near the behavior they cover. A test is evidence of current enforcement, not a substitute for product approval.
- Review a contract when its feature is changed, and revisit inventory-only entries incrementally in priority order. Remove or reconcile contradictory text instead of layering duplicate rules.

## Planning and review workflow

[`AGENTS.md`](../../AGENTS.md) routes substantive work through `$implementation-planning` and `$code-review`. Planning requires a Product Decision Check before behavior-affecting edits: confirm the workflow and contract, distinguish authorized intent from current behavior, and ask with concrete tradeoffs if a consequential choice remains unresolved. Review treats an unapproved consequential product change as blocking. Independent, clearly authorized work can continue while a dependent product decision is pending.

## Why the existing guidance needed a stronger checkpoint

`AGENTS.md` already said to clarify consequential decisions, and implementation planning already said to stop for consequential ambiguity. Those statements were broad: they did not require looking for a feature contract, documenting what authorizes the proposed behavior, or making product approval a specific review question. Code review asked reviewers to establish intent and treat tests as evidence, but it did not explicitly block an observable product decision that lacked approval. The September 25 Generate Credits change could therefore be framed as a data-protection improvement and then covered by tests without resolving what the explicit button was supposed to mean.

The revised planning checkpoint would classify preservation as changing the outcome of an explicit operator action. Since the product owner had not authorized that change, implementation would pause for the concrete choice: replace manual text on regeneration, or preserve it and accept that regeneration no longer refreshes all matching credits. Review now requires the authorization source and blocks an unapproved choice. Routine technical decisions remain with the agent.
