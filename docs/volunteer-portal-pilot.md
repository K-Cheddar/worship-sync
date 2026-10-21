# Synthetic personal-access acceptance runbook

Personal access is standard functionality for all churches. This runbook replaces the earlier activation/pilot procedure; it adds no feature flag or church allowlist. See [deployment prerequisites](volunteer-portal-deployment.md) before any deployment.

Use an isolated nonproduction app and Firestore project with synthetic churches, volunteers and test-owned contacts. Never copy a production roster. Keep the independent bulk dispatcher off and use fake delivery unless test delivery is separately authorized. This code change performs no deployment or real delivery.

## Acceptance sequence

1. Verify the dedicated stable personal secret, HTTPS canonical Origin, Firestore rules/indexes, privacy-safe logs and recovery provider configuration. Check signed-in My Schedule as a control.
2. As an administrator, edit an active member in Teams ? Members, open Personal My Schedule access, prepare and copy a link. Verify preparation/copy makes no provider call. Repeat preparation; the same valid URL and fixed expiry must be retained.
3. Open the link in an accountless mobile browser. The fragment disappears, the volunteer sees current and past published assignments, and Draft/private notes, contacts, unrelated members and others' responses remain inaccessible. Inspect the permitted service plan.
4. Individually Accept and Decline, then bulk-accept pending upcoming assignments. Persisted earlier answers and past assignments remain unchanged; independently committed schedules survive partial failures and retries. Repeat the bulk operation safely.
5. Add/edit/remove time off and submit availability through the shared operations. Retain an unsaved time-off draft while an administrator changes saved dates; refreshing or completing another action must preserve the draft and require explicit conflict review/discard before saving again.
6. Refresh and reopen in the same browser/profile. Bounded session authority persists. Repeat with an existing administrator/human login in that browser: the explicitly redeemed volunteer identity still owns personal requests. Verify the human My Schedule separately.
7. With fake delivery, establish an independently verified unique contact, expire a synthetic credential using fixture time, then follow verified recovery into My Schedule. Shared/unverified contacts, STOP and abuse limits must fail safely. Never lower production lifetime to simulate expiry.
8. Replace access. Old links/sessions must fail, including an already-open tab and delayed write. Redeem the replacement, revoke it and verify reads/writes and recovery stay blocked until explicit administrator restoration.
9. Recheck legacy schedule-response links, cross-church isolation, cache/referrer/storage/telemetry and secure cookie/CSRF behavior. Record synthetic IDs and pass/fail evidence without full links, cookies, codes or contact values.

## Cleanup / incident handling

Stop fixture interaction, retain the independent dispatcher safeguards and inspect authoritative records before retrying uncertain mutations. Revoke synthetic member credentials through existing controls for permanent invalidation; closing a browser is insufficient. There is no portal activation switch to disable. Do not rotate/restore secrets or broadly restore the database as a convenient rollback. Preserve unrelated edits and remove only identified synthetic data through the existing retention procedure. Any production incident or code rollback uses the normal authorized operational process.

## Verification limits

Local browser and emulator results do not certify production secret consistency, TLS/proxy behavior, Firestore IAM/index deployment, provider readiness, live log capture, or real-phone close/reopen/reconnect behavior. Verify those separately before deployment. They are configuration and operational prerequisites, not product activation decisions.
