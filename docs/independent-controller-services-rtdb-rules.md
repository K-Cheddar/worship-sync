# Independent Controller and Services RTDB write authorization

This repository does not contain or deploy Firebase Realtime Database rules. `firebase.json` configures Firestore only. The shared-data custom token carries independent claims resolved by the server bootstrap:

- `controllerAccess`: `none`, `view`, `music`, or `full` (legacy `appAccess: "member"` resolves to `none`).
- `servicesAccess`: `edit` only when the member has Services edit or admin role; otherwise the normalized Services view/none value. Global Teams Edit does not grant Services access.
- `sharedDataAuthVersion`: `2`, to let rules reject already-issued tokens with the legacy Teams-to-Services elevation.

The token still contains the legacy `appAccess` claim for old clients. RTDB rules must require `sharedDataAuthVersion === 2` and use `controllerAccess` and `servicesAccess` independently. Rules must not infer Services rights from `appAccess`, Teams permissions, or Controller access.

## Authorization boundaries

- Services management authorization comes from `servicesAccess`.
- Presentation and timer/operator authorization comes from `controllerAccess`.
- The current `churches/{churchId}/data/services` collection also contains
  Controller-owned timer/runtime/display state edited by the overlay Service
  Times tool. This is a legacy dual-writer boundary: both a Services editor and
  an eligible Controller operator may write the collection through the current
  client persistence path. This does not grant Services UI or API permission to
  a Controller operator.

The client keeps these authorities separately as `serviceManagement` and
`serviceRuntime`. The shared Redux persistence listener allows a write when
either capability is true. This client check preserves the product workflow;
it does not provide field-level RTDB authorization.

## Required deployed rule behavior

Update the Firebase Realtime Database rules for `churches/{churchId}/data` to enforce all of the following, using the existing verified session, church, and paired-device checks already in the deployed rules:

- Service-management writes require the authenticated church scope, `auth.token.sharedDataAuthVersion === 2`, and `auth.token.servicesAccess === "edit"`.
- `presentation` writes require the existing presentation/operator policy based on `auth.token.controllerAccess` (`music`/`full` retain current behavior); `none` and `view` are denied.
- `timers` writes retain the current Controller/operator policy (`music`/`full` if that is the deployed rule today); Services edit must not grant timer writes.
- Controller-owned timer/runtime/display fields in the shared `services` collection must remain writable for eligible `controllerAccess` operators while the overlay Service Times tool writes those fields there. Services management writes remain authorized by `servicesAccess`.
- Reads and display-device writes remain governed by their existing policies. Do not broaden them as part of this change.

In particular, `controllerAccess: "none"` plus `servicesAccess: "edit"` may manage service data but must be denied presentation and Controller timer writes. `controllerAccess: "music"` or `"full"` plus `servicesAccess: "none"` may perform existing Controller timer/runtime operations but must not gain Services UI/API management access. A Services editor must not gain resource access through these claims.

## Hard separation requirement

The current services collection is not fully separated by writer category. A
strict security boundary between service-definition fields and Controller-owned
timer/display fields requires either field-level RTDB validation that enforces
the distinct claims per field, or moving Controller-owned runtime/display fields
to a separate RTDB path/API. Keep both claims independent; do not treat
Controller access as inherited Services permission. Do not claim the existing
collection is fully separated while both kinds of writes share it.

## Deployment requirement

Before production relies on this separation, deploy the RTDB rules first with a fail-closed `sharedDataAuthVersion === 2` check, then deploy the server that issues version 2 claims, then ensure clients refresh their shared-data custom token and sign in to the RTDB identity again. Deploying the rule gate first prevents legacy tokens from retaining the old Teams-to-Services elevation; writes may be temporarily denied until the server and clients are updated. Do not add a legacy fallback that treats Teams Edit or `appAccess` as Services Edit.

After rollout, verify with decoded fresh tokens and real RTDB writes that (1) Teams Edit + Services None is denied on service-management fields, (2) Services Edit + Controller None can write service-management fields but not `presentation` or `timers`, and (3) Controller Music/Full + Services None retains only the existing Controller runtime operations. Verify display reads/writes and church/paired-device constraints remain unchanged. This repository does not contain the deployed rules or credentials, so production rule deployment and live allow/deny checks remain unverified here. Until they are deployed, the Firebase authorization issue is not fully resolved.
