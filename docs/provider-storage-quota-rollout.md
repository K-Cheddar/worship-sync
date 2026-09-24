# Provider storage quota rollout

Cloudinary and Mux quota enforcement is gated by `CHURCH_PROVIDER_STORAGE_QUOTAS_ENABLED`. Keep it unset or set to `false` until every existing church has been reconciled. New permanent uploads still receive provider ownership metadata while the gate is off.

## Apply quotas after a completed backfill

When the provider-storage backfill is already complete and every church is ready with no issues, do not run the backfill again to change quota limits. Deploy the server defaults from `server/churchStorageQuota.js`, then apply only the required church overrides in Firestore:

| Firestore document | Field path | Value |
| --- | --- | ---: |
| `churches/eliathah` | `storageQuotas.muxMinutes` | `2000` |
| `churches/demo` | `storageQuotas.r2Bytes` | `524288000` |

In the Firestore console, edit the existing church document and add or update only the listed nested field. If `storageQuotas` does not exist, create it as a map with that one field. Preserve any other fields and map entries. Do not replace the whole church document or change `providerUsageReady`, quota ledger, reservation, or provider asset documents. These updates do not change recorded usage or provider ownership.

The defaults are R2 `2147483648` bytes (2 GiB), Cloudinary `524288000` bytes (500 MiB), and Mux `1000` minutes. The `eliathah` and `demo` maps stay partial; unspecified providers inherit those defaults.

Before enabling enforcement, use an authenticated session to read `GET /api/churches/{churchId}/storage-quota` for a normal church, `eliathah`, and `demo`. Confirm the returned `quotas` report limits of 2147483648 / 524288000 / 1000 for a normal church; the same values with Mux 2000 for `eliathah`; and R2 524288000 with Cloudinary 524288000 / Mux 1000 for `demo`. Confirm the `used` values still match the completed backfill and the church documents still have `providerUsageReady: true`. Keep `CHURCH_PROVIDER_STORAGE_QUOTAS_ENABLED` unset or `false` until those checks pass; this quota configuration does not enable enforcement.

## Production sequence

1. Deploy the server and client with `CHURCH_PROVIDER_STORAGE_QUOTAS_ENABLED=false`. Confirm Cloudinary, Mux, Firebase Admin, and CouchDB credentials are present in the backfill environment. The backfill process never prints credentials.
2. Run `npm run backfill:provider-storage:dry-run -- --report=provider-storage-dry-run.json`. Review every church and issue in the report. Confirm each referenced asset resolves in its provider and that totals match the provider dashboards and known Media libraries. Resolve ambiguous or unowned entries manually; the script does not guess.
3. Run `npm run backfill:provider-storage -- --report=provider-storage-run.json`. This first clears each church's readiness marker, then records actual Cloudinary bytes and Mux duration, adds Cloudinary church context or Mux passthrough when missing, and marks a church ready only after its scan has no issues. If interrupted, affected churches remain fail-closed until a clean rerun.
4. Run the dry run again and compare its per-church totals with the completed run. Confirm the completed run report says `complete: true`, the new dry-run report has zero issues, and the per-church totals match. Confirm Firestore has `providerUsageReady: true` for every church and inspect the Cloudinary/Mux usage values in the church quota ledger.
5. Only after those checks pass, activate `CHURCH_PROVIDER_STORAGE_QUOTAS_ENABLED=true` on the server and restart/roll out all server instances. An unreconciled church receives a typed 503 and cannot begin a permanent Cloudinary or Mux upload; this is a fail-closed guard against activation ahead of backfill.
6. Smoke test one under-limit permanent image and video upload, then a quota denial in a controlled church, and verify a provider deletion releases only its recorded usage. Keep the run report with the deployment record.

To roll back admission behavior, set the flag to `false` and restart the server. Ownership metadata, provider assets, and usage records remain in place; rerun reconciliation after resolving any report issue before re-enabling limits.

The script scans media library references and already-owned quota-ledger entries. It does not enumerate all assets in the Cloudinary or Mux accounts, since account-wide unreferenced assets cannot be assigned safely. Any known unreferenced provider assets must be reviewed manually and either linked to a church media record or left outside church quota ownership before activation.
