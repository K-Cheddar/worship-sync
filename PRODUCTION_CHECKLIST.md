# Production Readiness Checklist

## ✅ Completed

- [x] Electron app builds for Windows, macOS, and Linux
- [x] GitHub Actions workflow for automatic releases
- [x] Environment detection (Electron vs Web)
- [x] API base path configuration for both environments
- [x] Service worker disabled in Electron
- [x] Download button on home page
- [x] CORS configuration for Electron requests
- [x] Certificate error handling for development

## 🔧 Configuration Required

### 1. GitHub Repository Information

Update these environment variables or edit `client/src/utils/githubRelease.ts`:
- `VITE_GITHUB_REPO_OWNER` - Your GitHub username or organization
- `VITE_GITHUB_REPO_NAME` - Repository name (default: "worship-sync")

### 2. Electron Icons

The electron-builder config references icons. You may want to create platform-specific icons:
- **Windows**: Create `build/icon.ico` (256x256 with multiple sizes)
- **macOS**: Create `build/icon.icns` (512x512 with multiple sizes)
- **Linux**: `public/WorshipSyncIcon.png` is used (should be 512x512)

**Quick fix**: The current config uses `public/WorshipSyncIcon.png` for all platforms, which works but platform-specific icons are recommended.

### 3. Production API URL

For production Electron apps, configure the API URL:

**Option A: Environment Variable**
Set `VITE_ELECTRON_API_URL` in your build process:
```bash
VITE_ELECTRON_API_URL=https://your-api-domain.com/ npm run build:electron
```

**Option B: Update Default**
Edit `client/src/utils/environment.ts` line 49 to use your production API URL instead of `localhost:5000`.

### 4. Auth rollout configuration

Before enabling the new auth flow in production:
- Set `AUTH_SESSION_SECRET`
- Set `AUTH_APP_BASE_URL` (used as the primary CORS origin in production when `NODE_ENV` is not `development`; the server derives the browser origin from this URL)
- Set `AUTH_ALLOWED_ORIGINS` to the exact browser origins allowed to use cookie auth
- **API availability**: Sign-in, session bootstrap, and Firebase custom tokens require a reachable API. If the server is down or misconfigured, clients cannot authenticate or load shared realtime data. This is expected; there is no fully offline authenticated mode.
- Set `RESEND_API_KEY`
- Set `RESEND_FROM_EMAIL`
- Set `RESEND_WEBHOOK_SECRET`
- Configure the Resend webhook endpoint at `/api/webhooks/resend`
- Verify the Firebase Admin credentials used by the server
- Verify the Firebase project can mint custom tokens for shared Realtime Database access
- Rotate any previously exposed shared Firebase credentials and disable that account

#### Schedule notification emails

- Set `AUTH_ASSIGNMENT_RESPONSE_TOKEN_SECRET`, and use a **different value in
  each environment**. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  ```
  It signs the accept/decline links volunteers get by email. Unset, it falls back
  to `AUTH_SESSION_SECRET` and then to the literal `"dev-auth-secret"`, which is
  committed to this repository — anyone could then mint a link that answers on a
  volunteer's behalf. Distinct values per environment also mean a staging link is
  inert against production. Links live for 120 days, so a rotation invalidates
  every outstanding one.
- `AUTH_APP_BASE_URL` **must** be set per environment, not only in production.
  It is what these emails build their links from, and it defaults to the
  production URL. Left unset on staging, staging emails send volunteers to
  production carrying staging-signed tokens, which production rejects as invalid
  — a dead link with a 120-day tail.
- **Existing editors start receiving schedule-response digests on deploy.**
  Preferences default to on for all four notification categories, so anyone with
  team-edit access begins getting mail without having seen a switch. Intended,
  but it lands without warning; the switches are in the account popover.
- **The digests assume a single instance.** They coalesce with in-process timers
  plus a marker on the document. Correct on one dyno; the moment a second exists,
  both instances send the same digest, and nothing warns you.

**CORS note (production vs earlier behavior):** Previously, production still used `http://localhost:3000` as the default `frontEndHost` while `AUTH_APP_BASE_URL` was added separately to the allowlist. The server now uses the **origin of `AUTH_APP_BASE_URL`** as the default production `frontEndHost`, so the primary allowed origin matches your deployed app URL. Localhost remains the fallback when `AUTH_APP_BASE_URL` is unset (for local production-style testing).

Validate these operator paths before cutover:
- Human sign-in from web
- Human sign-in from Electron
- Trusted-device return after restart
- Workstation pairing and operator prompt
- Display pairing and blocked-state recovery
- Projector, monitor, stream, and board routes from bookmarked URLs
- Admin invite, password reset, and admin recovery flows

### 5. macOS Code Signing (Optional but Recommended)

To sign macOS builds, add these GitHub Secrets:
- `MAC_CERTIFICATE` - Base64 encoded .p12 certificate
- `MAC_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_ID` - Apple Developer ID email
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Apple Team ID

### 6. Windows Code Signing (Optional but Recommended)

For Windows, you'll need a code signing certificate. Configure in `electron-builder.config.js`:
```js
win: {
  certificateFile: "path/to/certificate.pfx",
  certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
  // ...
}
```

## 🧪 Testing Checklist

Before releasing:

- [ ] Test Electron app on Windows
- [ ] Test Electron app on macOS (if available)
- [ ] Test Electron app on Linux (if available)
- [ ] Verify API calls work in Electron
- [ ] Verify download button works on home page
- [ ] Test auto-update mechanism (if implemented)
- [ ] Verify icons display correctly
- [ ] Test offline functionality (if applicable)
- [ ] Verify error handling for server unavailability

## 📝 Additional Considerations

### Error Handling

Consider adding better error handling for:
- Server connection failures
- Network timeouts
- API errors

### Auto-Updates

Consider implementing auto-updates using:
- `electron-updater` package
- GitHub Releases API
- Update notifications

### Analytics

Consider adding analytics to track:
- App usage
- Error rates
- Feature adoption

### Documentation

Ensure users know:
- How to install the app
- System requirements
- How to report issues
- Where to get updates

## 🚀 Release Process

1. Update version in `client/package.json`
2. Create and push git tag: `git tag vX.X.X && git push origin vX.X.X`
3. GitHub Actions will automatically:
   - Build for all platforms
   - Create/update GitHub Release
   - Upload installers
4. Verify release assets on GitHub
5. Test download links
6. Announce release

## 🔍 Post-Release

- Monitor error logs
- Collect user feedback
- Track download statistics
- Plan next release
