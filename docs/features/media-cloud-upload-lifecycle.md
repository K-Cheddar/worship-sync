# Media cloud upload lifecycle

## Confirmed product intent

The current user request, November 24, 2026, confirms that an accepted local
media cloud upload continues when the operator closes or leaves the Media
route. Closing Media alone does not cancel the upload.

## Implementation references

- `client/src/containers/Media/localMediaCloudShare.tsx`
- `client/src/context/transferContext.tsx`
- `client/src/containers/Media/localMediaCloudShare.lifecycle.test.tsx`
