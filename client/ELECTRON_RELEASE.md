# Electron App Release Guide

This document explains how to build and release the WorshipSync Electron desktop app.

## Automatic Releases via GitHub Actions

The Electron app is automatically built and published to GitHub Releases when you create a new version tag.

### Creating a Release

1. **Update the version** in `client/package.json`:
   ```json
   "version": "1.12.1"
   ```

2. **Create and push a git tag**:
   ```bash
   git tag v1.12.1
   git push origin v1.12.1
   ```

3. **GitHub Actions will automatically**:
   - Build the Electron app for Windows, macOS, and Linux
   - Create a GitHub Release with all platform installers
   - Upload the installers as release assets

### Manual Release (via GitHub UI)

1. Go to the repository's "Releases" page
2. Click "Draft a new release"
3. Choose or create a tag (e.g., `v1.12.1`)
4. Fill in the release title and description
5. Click "Publish release"
6. The GitHub Actions workflow will automatically build and attach the Electron app installers

## Local Building

To build the Electron app locally:

### Prerequisites

- Node.js 20.x
- All dependencies installed (`npm ci` in root and `client` directories)

### Build Commands

```bash
# Build for current platform
cd client
npm run build:electron
npm run electron:build

# Build for specific platform
npm run build:electron
npx electron-builder --win    # Windows
npx electron-builder --mac    # macOS
npx electron-builder --linux   # Linux
```

### Build Outputs

Built installers will be in `client/release/`:
- **Windows**: `WorshipSync Setup X.X.X.exe` (NSIS installer)
- **macOS**: `WorshipSync-X.X.X.dmg` (Disk image)
- **Linux**: `WorshipSync-X.X.X.AppImage` and `.deb` package

## Development

To run the Electron app in development mode:

```bash
cd client
npm run electron:dev
```

This will:
1. Start the Vite dev server
2. Build Electron files
3. Launch Electron connected to the dev server

## Configuration

### Electron Builder Config

The Electron app build configuration is in `client/electron-builder.config.js`.

### Environment Variables

For Electron builds, you can set:
- `VITE_ELECTRON_API_URL` - API base URL for Electron (defaults to `http://localhost:5000/` in production, `https://local.worshipsync.net:5000/` in development)

### macOS Code Signing (Optional)

To sign macOS builds, set these secrets in GitHub:
- `MAC_CERTIFICATE` - Base64 encoded certificate
- `MAC_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_ID` - Apple Developer ID
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Apple Team ID

## Troubleshooting

### Build Fails

1. Ensure all dependencies are installed: `npm ci` in both root and `client`
2. Check that the web app builds successfully: `cd client && npm run build`
3. Verify Electron files are built: `cd client && npm run build:electron:files`

### Release Not Created

1. Check GitHub Actions workflow logs
2. Ensure the tag format is correct: `vX.X.X`
3. Verify repository has `contents: write` permission for GitHub Actions

### App Won't Connect to Server

1. Ensure the server is running
2. Check the API URL in `client/src/utils/environment.ts`
3. For development, ensure the server is running on `https://local.worshipsync.net:5000`
