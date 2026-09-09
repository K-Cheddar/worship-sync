# Canva Connect setup

WorshipSync uses Canva Connect OAuth to let a church admin connect one Canva
account for the church. Full-access church members can then import PNG images or
MP4 video from the Media library. Exported files are copied into WorshipSync's
Cloudinary or Mux storage; temporary Canva export URLs are never saved as media.

Each imported asset stores a Canva identity containing the design ID, Canva's
current `updated_at` revision, the export format, and the selected page(s).
Before exporting, the server fetches the design again and skips only identities
already present in the church's Media library. Editing the design changes its
revision and allows it to be imported again.

Canva-sourced Media items also retain structured source metadata. Operators can
open **Manage Canva source** on a selected item to check the current design
revision, open Canva's fresh edit URL, and manually refresh the item. Refreshing
keeps the WorshipSync media ID, name, folder, and creation date while replacing
its stored Cloudinary or Mux rendition. Existing saved or live service content
is not rewritten automatically.

## Weekly presentations from someone else's Canva file

Canva does not allow WorshipSync to import a private design from a public view
link alone. The design must be available to the **church-connected Canva
account**.

Recommended weekly flow:

1. Designer shares the design with the church Canva account (view or edit).
2. In Media, open **Import from Canva**.
3. Paste the design link or id under **Open by link**, or browse/search the
   connected account's designs.
4. Choose **PNG images** (still pages) or **MP4 video** (baked motion).
5. For multi-page PNG imports, keep **Create a custom item with one slide per
   page** enabled when you want one outline item you can advance in WorshipSync.

Animations tradeoff:

- **PNG** — no live motion; advance slides in WorshipSync.
- **MP4** — motion is baked into one clip; not Canva Present click-through.
- **Live Canva Present** (full animations + click-through) — open Present in
  Canva, then use Media **Add screen or window**, share that screen/window, and
  **Send** it to the chosen local display (or create a **live input item** and
  select its slide). Capture stays on this computer only.

## Canva Developer Portal

Create a Canva Connect integration and enable these scopes:

- `design:meta:read`
- `design:content:read`
- `profile:read`

Register this redirect URL, using the deployed WorshipSync server origin:

`https://your-worshipsync-origin.example/api/canva/oauth/callback`

## Server environment

Set the following variables:

- `CANVA_CLIENT_ID`
- `CANVA_CLIENT_SECRET`
- `CANVA_TOKEN_ENCRYPTION_KEY` — a dedicated, high-entropy secret used to
  encrypt Canva access and refresh tokens at rest. Keep this stable across
  deploys; rotating it requires churches to reconnect Canva.
- `CANVA_OAUTH_REDIRECT_URI` — optional when the callback URL can be derived
  from the configured frontend/server origin. Set it when the public callback
  differs.

Image imports also require the existing Cloudinary credentials. Video imports
require the existing Mux credentials.
