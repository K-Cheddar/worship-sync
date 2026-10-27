/** Presentation workspace roots; library and settings sections keep their routes. */
export const isControllerWorkspacePath = (pathname: string) =>
  /^\/(?:controller|aux-controller\/[^/]+)\/?$/.test(pathname);
