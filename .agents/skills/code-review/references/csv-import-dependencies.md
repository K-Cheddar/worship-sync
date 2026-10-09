# CSV import and dependency creation matrix

Consult when a change affects CSV parsing, preview, relationship resolution, team/position creation, commit, or retry after partial import. Keep entity identity separate from import-row identity.

| Adversarial sequence | Inspect in code | Evidence to seek |
| --- | --- | --- |
| Two approved CSV aliases resolve to one new destination entity | Normalization, alias-to-entity maps, dependency creation, and row relationship application | Commit creates/reuses one destination ID and all approved rows point to that same ID; row identity does not create duplicate entities. |
| Multiple teams contain positions with the same name | Team ownership resolution and position matching/creation keys | Preview and commit preserve the selected team; identical names under different teams remain distinct entities. |
| A dependency is created, a later step fails, then the user retries or repeats review/approval | Durable results/checkpoints, re-preview matching, prior approvals, duplicate prevention, and stale-preview validation | Earlier dependency IDs are recognized, valid approvals remain usable or are deliberately refreshed, and completed work is not duplicated. |
| After partial success, merge/replace or blank-clearing options change | Dependency reconciliation key and the separate commit options | Durable dependency identity uses only identity-defining inputs. Changing an unrelated option does not make an existing team/position unrecognizable; the new option still controls its own commit semantics. |
| Preview and commit see different state or a stale preview | Shared resolution rules, preview token/hash/settings, and commit-time validation | The applied result matches the approved preview or returns a recoverable stale-preview result without applying a different mapping. |

When choosing a durable key, ask whether each included field defines the dependency entity or only the current import's behavior. Keep file row numbers and other row-level provenance separate from reusable team/position identity. Duplicate prevention must not reject legitimate recovery after a dependency has already been created.
