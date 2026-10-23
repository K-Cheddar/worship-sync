let credential = "";

export const isVolunteerPortalPath = (pathname: string) => /^\/s\/?$/.test(pathname);

// Called before console forwarding, telemetry or application bootstrap.
export const scrubVolunteerIngress = () => {
  if (!isVolunteerPortalPath(window.location.pathname)) return;
  credential = window.location.hash.slice(1);
  window.history.replaceState(null, "", window.location.pathname);
};
export const readVolunteerIngress = () => credential;
export const clearVolunteerIngress = () => { credential = ""; };
