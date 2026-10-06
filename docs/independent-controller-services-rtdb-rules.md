# Independent Controller and Services RTDB write authorization

This repository does not contain or deploy Firebase Realtime Database rules. `firebase.json` configures Firestore only. The shared-data custom token now carries two minimal claims resolved by the server bootstrap:

- `controllerAccess`: `none`, `view`, `music`, or `full` (legacy `appAccess: "member"` resolves to `none`).
- `servicesAccess`: `edit` when the member has Services edit, the existing global Teams edit compatibility grant, or admin role; otherwise the normalized Services view/none value.

The token still contains the legacy `appAccess` claim for old clients. New RTDB rules must use `controllerAccess` and `servicesAccess` for authorization and must not infer Service-time rights from `appAccess`.

## Required deployed rule behavior

Update the Firebase Realtime Database rules for `churches/{churchId}/data` to enforce all of the following, using the existing verified session, church, and paired-device checks already in the deployed rules:

- `services` writes require the authenticated church scope and `auth.token.servicesAccess === "edit"`. A Controller claim alone must never grant this write.
- `presentation` writes require the existing presentation/operator policy based on `auth.token.controllerAccess` (`music`/`full` retain current behavior); `none` and `view` are denied.
- `timers` writes retain the current Controller/operator policy (`music`/`full` if that is the deployed rule today); Services edit must not grant timer writes.
- Reads and display-device writes remain governed by their existing policies. Do not broaden them as part of this change.

In particular, `controllerAccess: "none"` plus `servicesAccess: "edit"` must allow service-time writes and deny both presentation and timer writes. A Services editor must not gain resource access through these claims.

## Deployment requirement

Before production relies on this separation, the Firebase administrator must update the deployed RTDB rules to recognize the two claims above, run allow/deny checks for the three paths, and verify legacy `appAccess` clients still behave as intended during rollout. Until those rules are deployed, the client capability checks are UX guards only; the current deployed rules remain the security boundary and may still deny the Services write.
