# YouTube song search

Song-video search is served by `GET /api/youtube/search` and uses the official
YouTube Data API `search.list` operation, followed by one `videos.list` call to
enrich the returned IDs with duration and embeddable status. The route requires
the normal WorshipSync app session.

Set `YOUTUBE_API_KEY` on the server deployment. It is intentionally not a
required startup variable: without it, the route returns a clear 503 response
and the rest of WorshipSync continues to start. The key is only sent in
server-to-YouTube requests and is never included in normalized client results.

Search results are cached in the server process by a trimmed, whitespace-
collapsed, lower-case query key for 60 days. The cache is bounded to 500 keys,
and `refresh=true` bypasses and replaces a cached result. This cache is
process-local and is therefore not shared across server instances or restarts;
the bounded memory cache avoids introducing new persistence infrastructure for
the first phase.
