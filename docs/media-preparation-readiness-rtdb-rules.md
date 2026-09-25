# Media preparation readiness Realtime Database rules

This checkout does not define or deploy Realtime Database rules. The root
`firebase.json` only names Firestore rules and indexes. The readiness publisher
therefore requires a separate Realtime Database rules update in the Firebase
project before remote telemetry can be considered authorized or production
verified.

## Required authorization

Readiness data is transient and output scoped:

```text
churches/{churchId}/data/presentation/mediaPreparationReadiness/{outputId}/{deviceId}/{sessionId}
```

Configure the project's existing authorization claims and role model so that:

- A signed-in controller authorized for `{churchId}` can read readiness below
  that church's presentation path.
- A paired display authorized for `{churchId}` and `{outputId}` can write and
  remove only its own `{deviceId}/{sessionId}` leaf. It cannot write another
  output, device, session, church, or the parent collection.
- A user without the required session authorization, and a session authorized
  for another church or output, is denied.
- Validation requires the readiness contract `worshipsync.media-preparation-readiness`,
  version `1`, path-matching output/device/session IDs, finite timestamps,
  nonnegative integer counts no greater than `50000`, category totals that do
  not exceed `candidateCount`, finite readiness totals that do not exceed
  `finiteCandidateCount`, and at most eight error strings of at most 180
  characters each.
- `onDisconnect().remove()` and explicit removal are allowed only at the
  authorized session leaf. Session data must not be writable by other display
  sessions.

Do not copy a guessed claim name into production rules. Bind these checks to the
same verified church and paired-output claims already used by the deployed
presentation and manifest rules. Keep the readiness rule separate from the
manifest write rule: displays report only their own readiness, while controllers
own manifest publication.

## Verification procedure

1. In Firebase Console, select the same project and Realtime Database instance
   used by WorshipSync (not Firestore). Open **Realtime Database → Rules** and
   inspect the deployed rules for the path above.
2. In the Rules Playground or the project's Realtime Database emulator, test a
   signed-in authorized controller reading one church's readiness subtree; it
   must succeed.
3. Test a paired display writing a valid report to its claimed church, output,
   device, and session leaf, then removing that leaf; both operations must
   succeed.
4. Repeat the write with a different church ID, output ID, device ID, and
   session ID; each must be denied. Test an unauthenticated user and a user
   lacking the paired-display/controller role; each must be denied.
5. Submit invalid version/contract values, mismatched path IDs, negative or
   fractional counts, category sums above `candidateCount`, finite readiness
   sums above `finiteCandidateCount`, more than eight errors, and an error over
   180 characters; each must be denied.
6. Verify that a display cannot write to the manifest path and that a controller
   cannot use readiness rules to write another church's data.
7. Reconnect an authorized display and confirm its bounded readiness writes
   resume without creating a second active session entry. Leave the display
   disconnected and confirm `onDisconnect` removes its session leaf.

Until these steps pass against the deployed rules or the configured emulator,
the UI's receipt/readiness feedback is best-effort and must not be treated as a
security or delivery guarantee.
