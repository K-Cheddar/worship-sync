# Song TXT import

## Confirmed product intent

The October 18, 2026 TXT import request authorizes local, single-file TXT import in
Create Song, including its embedded Service Plan form. No backend, scraping, API,
bulk import, arrangement merging, or existing-song update is part of this feature.

Selecting a file never saves a song. Review and edit the extracted name, metadata,
lyrics, and formatted sections, then apply to the existing creation draft. An
existing draft requires explicit replacement confirmation and can be left intact
by cancelling. The normal Create Song action owns persistence.

Before creating a song, identify potential library duplicates by CCLI song number
or normalized title. Offer existing songs, return to editing, and explicit separate
creation. Existing songs and arrangements must never be overwritten by import.

## Product decisions

- **Source/date:** Current TXT import request, October 18, 2026.
  Import requires review/apply and existing-draft confirmation; auto-save and silent
  draft replacement are excluded.
- **Source/date:** Same request. Creation of a potential duplicate requires explicit
  separate creation. This also covers manually entered songs through the shared
  Create Song action; a same-title create previously proceeded directly.
- **Source/date:** Same request. Recognized metadata and license boilerplate are
  excluded from lyrics. Ambiguous content is retained and flagged for operator
  review rather than guessed away. Missing metadata is not invented.

## Implementation and compatibility observations

`SongTxtImport` is inline and uses shared controls, with no new portal or modal.
`songTxtImport.ts` extracts metadata and decodes UTF-8, BOM-marked UTF-16, and
Windows-1252 fallback. Input is bounded to 1 MB and binary control text is rejected.
Labeled metadata and isolated titles before section labels are recognized.
Short unlabelled credit blocks grouped with CCLI/copyright footers and copyright
continuations are preserved as editable metadata with classification warnings.
Other unrecognized credits and nonstandard layouts may require manual correction.

The existing `inferLyricsSections`, `createSections`, `updateFormattedSections`,
`createNewSong`, formatting, and persistence path remain authoritative. Opening
unlabeled lyrics survive even if later sections use explicit labels.

Imported metadata uses the existing `manual` source and optional fields. Read-only
inspection of `in-progress-3` found its Song v2 codec copies `songMetadata` as a
whole to/from the root document. This branch does not implement or modify v2.

Tests: `songTxtImport.test.ts`, `CreateItem.test.tsx`, and existing section/item and
Service Plan picker tests cover the parser, decisions, creation and consumers.
