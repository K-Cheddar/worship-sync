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

### 4. macOS Code Signing (Optional but Recommended)

To sign macOS builds, add these GitHub Secrets:
- `MAC_CERTIFICATE` - Base64 encoded .p12 certificate
- `MAC_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_ID` - Apple Developer ID email
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Apple Team ID

### 5. Windows Code Signing (Optional but Recommended)

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
