# Service countdowns

## Confirmed product intent

Authorization: production correctness request, October 14, 2026.

- Controller, workstation, paired monitor, projector, and stream resolve a weekly church service to the same absolute instant using the church's configured IANA time zone and synchronized server clock.
- An authenticated paired display may read only its own church's service time zone. Active human church members may also read that setting for their own church, even without controller, Teams, or Services access. These reads grant no workspace or editing permissions, and revoked identities cannot read the setting.
- Missing or failed configuration must not silently become UTC or show a misleading countdown. The existing `--:--` placeholder represents an unavailable target.
- Reconnects and configuration changes must recover without re-pairing.

The October 23, 2026 access correction uses the existing authenticated human session and active church membership validation for both the timezone GET and revision stream. Members without broader workspace access receive only the restricted timezone response; configured church settings remain authoritative, and an unconfigured timezone has no fallback value.

## Implementation and verification

`App.tsx` mounts `ChurchServiceTimeZoneProvider` under `GlobalInfoProvider` for all routes. Displays use their pairing credential explicitly on the narrow timezone GET; the handler resolves current credentials and checks church ownership before reading settings. Configuration is revalidated every minute, on browser online events, and on realtime connection changes. Session/device changes invalidate cached ownership. Known errors suppress countdowns until a successful response; a refresh retains an already validated value while awaiting its result.

`useDisplayedUpcomingService` resolves occurrences from the configured zone and `serverDate()`. `TimerDisplay` consumes the same hook through the projector, monitor, and stream paths. Stream transparency and presentation permissions are unchanged.

Regression evidence: `client/src/context/pairedDisplayCountdown.integration.test.tsx` composes the real provider, HTTP client, Firebase service listener, occurrence resolver, server offset, and timer text. `server/teamsApi.test.js` exercises real pairing/redeem/bootstrap and negative authorization boundaries.
