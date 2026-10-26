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

The [Teams and Services navigation contract](responsive-navigation.md) and [Church Administration navigation contract](church-administration-navigation.md) record their confirmed responsive shell organization and scope.
The [Current member identification contract](current-member-identification.md) records the confirmed identity resolution and presentation behavior for **You** markers across Teams and Services.
The [Resources responsive browsing contract](resources.md) records the October 20, 2026 request for compact mobile browsing, shared file-type visuals, and existing permission-aware resource actions.
The [Account Team Leads contract](account-team-leads.md) records account-scoped team leadership, personal routine email eligibility, and durable digest delivery confirmed on October 23, 2026.

The [Manual item-library search contract](item-library-search.md) records shared manual relevance, conservative typo retrieval, stable-ID content lookup, and preserved automatic song-identification safeguards confirmed October 24-25, 2026.

The [Item document storage contract](item-document-storage.md) records document ownership, the shared PouchDB cache lifecycle, independent outlines and historical-index safety confirmed October 26, 2026.

## Feature inventory

Only workflows specifically labeled as confirmed contracts are documented as owner-confirmed. All other registry workflows are **inventory only**: their broad labels are observed from current product surfaces and need product-owner validation before being treated as behavioral contracts. Implementation references help locate features; they are not requirements.

Existing `docs/` pages are focused architecture, migration, and rollout references; this registry complements them rather than replacing them.

| Feature area | Observed workflow (draft) | Related areas | Implementation starting points | Contract status | Priority |
| --- | --- | --- | --- | --- | --- |
| Board Moderation sessions | Review discussion board and Restream activity, then keep or safely reset stale sessions. | Live service, Restream integration, public discussion boards | [Board Moderation sessions contract](board-moderation-sessions.md), `client/src/pages/BoardController.tsx` | Confirmed product intent; current request | P1 — session resets must protect today's activity and remain operator-confirmed |
| Controller content viewing from service plans and libraries | Inspect songs, scripture, custom documents, and other attached resources in their existing WorshipSync viewers. | Live presentation, service plans, songs, custom documents | controller-content-viewing.md, client/src/pages/Controller/ControllerServicePlanView.tsx, client/src/components/FilteredItems/ | Confirmed product intent; current request | P1 — controller workflow must remain read-only until an explicit presentation action |
| Live-service multi-output presentation | Prepare a service, select content, present it across controller, projector, monitor, stream, and auxiliary outputs, and recover from output/media problems. | Service plans, overlays, media, timers, display settings | `client/src/pages/Controller/Controller.tsx`, `client/src/pages/Controller/CurrentServiceWorkspace.tsx`, `client/src/pages/AuxController/AuxController.tsx`, `client/src/components/DisplayWindow/` | Inventory only; intent review needed | P1 — live-service risk across multiple output surfaces |
| Participant overlays, Generate Credits, and post-service correction | Prepare participant overlays and serving information, generate/edit credits, and correct them to reflect who served. | Live presentation, team schedules, service plans | [Overlay synchronization contract](overlay-synchronization.md), [Generate Credits contract](generate-credits.md), `client/src/pages/OverlayController/OverlayController.tsx`, `client/src/pages/CreditsEditor/CreditsEditor.tsx`, `client/src/containers/Overlays/` | Overlay synchronization has two owner-confirmed outcomes; broader overlay behavior is inventory only. Generate Credits has confirmed regeneration, assigned-role creation, and retry-safe reporting; loaded-empty schedule semantics, unavailable-source fallback, and ambiguous grouped-role handling remain open | P1 — explicit regression history and public presentation |
| Service-plan import, review, save/sync, and publication | Import an outside plan, resolve ambiguities, save or synchronize it, then use it in controller and public views. | Live presentation, songs, assignments, public views | [Service-plan import contract](service-plan-import.md), `client/src/pages/Services/`, `client/src/pages/Controller/ControllerServicePlanView.tsx`, `server/planningCenterPlanImport.js`, `client/src/pages/Services/useServicePlanOutlinePush.ts` | Cross-section item matching and selectable relocation confirmed by current request; broader import and publication workflow remains inventory only | P1 — cross-source ownership and replacement/synchronization risk |
| Volunteer scheduling, response, substitutions, and availability | Build service schedules, request and track responses, update assignments, and manage personal availability/blockouts. | Teams, messaging, credits, service plans | `client/src/pages/Teams/schedule/`, `client/src/pages/MySchedule.tsx`, `client/src/pages/MyScheduleBlockouts.tsx` | [Confirmed product intent; current request](team-scheduling.md); [Phase 1 audit](../team-scheduling-foundation-phase-1.md); [Phase 2 implementation record](../team-scheduling-foundation-phase-2.md) | P1 — assignments and availability affect service readiness |
| Team roster, roles, and permission-gated access | Maintain teams, roles, positions, members, qualifications, and forms; grant access to team information. | Scheduling, notifications, administration | [Team roster editing contract](team-roster.md), `client/src/pages/Teams/pages/`, `client/src/pages/Teams/TeamsAndServices.tsx`, `server/teamsAuthHandlers.js`, `client/src/api/auth.ts` | Create/Edit Team membership editing is confirmed by the current request; broader roster and access workflows remain inventory-only | P1 — permissions and shared roster data |
| Current member identification | Recognize a signed-in user's linked roster member throughout authenticated Teams and Services views. | Team roster, schedules, forms, messages, service plans | [Current member identification contract](current-member-identification.md), `client/src/pages/Teams/components/CurrentUserMemberIndicator.tsx`, `server/teamsAuthHandlers.js` | Confirmed product intent; current request | P2 — member identity must stay accurate and private |
| Media upload, preparation readiness, and live playback | Upload and organize service media, confirm it is prepared/available, and use it during presentation. | Live presentation, service plans, storage | `client/src/containers/Media/`, `client/src/pages/ResourceUploadDialog.tsx`, `docs/media-library-v2-migration.md`, `docs/media-preparation-readiness-rtdb-rules.md` | Inventory only; intent review needed | P1 — live playback and durable media lifecycle |
| Team messages, volunteer responses, and delivery recovery | Send serving requests and other team communications, track responses, and recover from delivery failures. | Team schedules, members, public responses | [Availability form SMS contract](team-availability-sms.md), [Member SMS consent contract](member-sms-consent.md), `client/src/pages/Teams/pages/TeamsMessagesPage.tsx`, `client/src/pages/Teams/schedule/ScheduleMessagesPanel.tsx`, `server/teamsAuthHandlers.js` | Availability form SMS and member SMS consent have confirmed intent; broader team messaging remains inventory only | P1 — external communication, consent, and retry behavior |
| Team chat unread indicators and attention | Notice unread team chat while the Windows controller is behind another application. | Team chat, Electron taskbar, read state | [Team Chat Taskbar Notifications contract](team-chat-taskbar-notifications.md), `client/src/chat/ChatContext.tsx`, `client/electron/chatTaskbar.ts` | Confirmed for Windows Electron Phase 1 by the current request | P1 — unread state must follow the active operator and remain independent from media progress |
| Public service/team access and response | Share service information, participant credits, team schedules, intake, and response pages with people outside the controller. | Plans, credits, schedules, permissions | [Personalized team intake contract](personalized-team-intake.md), `client/src/pages/ServicePublic.tsx`, `client/src/pages/ServicePublicView.tsx`, `client/src/pages/Teams/TeamSchedulePublic.tsx`, `server/servicePlanPublic.js` | Personalized intake profile completion is confirmed by the current request; broader public access remains inventory only | P1 — public data visibility and access boundaries |
| Discussion Board Controller | Review and moderate discussion board and Restream activity, manage sessions, and publish messages to the supported destinations. | Live service, public boards, Restream, YouTube | [Discussion Board Controller contract](discussion-board-controller.md), `client/src/pages/BoardController.tsx` | Confirmed mobile UX intent; desktop and data behavior retain existing implementation | P1 — live moderation and public messages |
| Equipment and assignments | Assign people and equipment such as microphones to service-plan items or team schedule slots. | Service plans, team schedules, equipment inventory | `client/src/pages/Services/ServicePlanAssigneeList.tsx`, `client/src/pages/Teams/schedule/ScheduleEquipmentSelect.tsx`, `client/src/pages/Teams/pages/TeamsMicrophonesPage.tsx` | Inventory only; intent review needed | P2 — cross-feature assignment ownership and availability |
| Application settings and administration | Configure account, integrations, controller outputs, and church/team administration. | Live presentation, permissions, all configured features | `client/src/pages/Controller/AccountFormSections.tsx`, `client/src/pages/Controller/IntegrationsSettingsPanel.tsx`, `client/src/pages/Teams/pages/TeamsServiceSettingsPage.tsx`, `client/src/pages/Account/` | [Church Administration navigation](church-administration-navigation.md) confirms responsive navigation only; page workflows remain inventory pending review | P2 — broad impact, but document alongside the workflows each setting controls |

## What to document next

The [Unified volunteer My Schedule contract](volunteer-my-schedule.md) records
the October 18, 2026 request for one volunteer interface, shared operations,
personal access, verified recovery and concise explicitly approved schedule SMS.
Its implementation record distinguishes completed stages from remaining work.

The [Song TXT import contract](song-txt-import.md) records the October 18, 2026
request for local TXT review, draft protection, and duplicate-song decisions.

Focused confirmed contracts from the October 14, 2026 production correctness request: [Service countdowns](service-countdowns.md) and [Song audio and editor conflicts](song-audio-conflicts.md). These authorize only the behaviors stated there; the broader inventory remains unconfirmed.

Create a small number of contracts around complete operator workflows, not one contract per button or component. Recommended order:

1. Service-plan import → ambiguity review → save/sync → controller and public use — document source ownership and what each import or push action replaces or preserves.
2. Live controller → multi-output presentation → recovery — document service-time operation, transitions, and responses to unavailable media or disconnected outputs.
3. Media upload → preparation readiness → playback — document local/remote availability and what an operator can rely on at service time.
4. Maintain the confirmed [Team Scheduling Contract](team-scheduling.md) and [Phase 1 audit](../team-scheduling-foundation-phase-1.md) as implementation decisions are resolved.
5. Public link access → service/team projection → response — document who can see which information and how a link or response action changes access.
6. Messaging, equipment, and administration page workflows — add focused contracts once the connected workflows above establish their boundaries. Church Administration navigation has its own focused contract; underlying settings workflows remain inventory only.

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
