const APP_TITLE = "WorshipSync";

const title = (pageName: string): string => `${pageName} | ${APP_TITLE}`;

/** Returns the browser title for a hash-router pathname. */
export const getPageTitle = (pathname: string): string => {
  if (pathname === "/" || pathname === "/home") return title("Home");
  if (pathname.startsWith("/controller")) return title("Controller");
  if (pathname === "/current-service") return title("Current Service");
  if (pathname === "/overlay-controller") return title("Overlay Controller");
  if (pathname === "/login") return title("Sign In");
  if (pathname === "/login/desktop-sso-complete") return title("Desktop Sign In");
  if (pathname === "/restream/connect-complete") return title("Restream Connection");
  if (pathname === "/youtube/connect-complete") return title("YouTube Connection");
  if (pathname === "/canva/connect-complete") return title("Canva Connection");
  if (pathname === "/invite") return title("Accept Invitation");
  if (pathname === "/auth/reset") return title("Password Reset");
  if (pathname === "/recovery/confirm") return title("Account Recovery");
  if (pathname === "/workstation/pair" || pathname === "/display/pair") {
    return title("Pair Workstation");
  }
  if (pathname === "/workstation/operator") return title("Workstation Operator");
  if (pathname === "/my-schedule") return title("My Schedule");
  if (pathname.startsWith("/account")) return title("Account");
  if (pathname.startsWith("/teams-and-services")) {
    if (pathname.startsWith("/teams-and-services/schedules")) return title("Schedules");
    if (pathname.startsWith("/teams-and-services/members")) return title("Members");
    if (pathname.startsWith("/teams-and-services/positions")) return title("Positions");
    if (pathname.startsWith("/teams-and-services/groups")) return title("Teams");
    if (pathname.startsWith("/teams-and-services/forms")) return title("Forms");
    if (pathname.startsWith("/teams-and-services/plans")) return title("Plans");
    if (pathname.startsWith("/teams-and-services/templates")) return title("Templates");
    if (pathname.startsWith("/teams-and-services/service-settings")) return title("Service Settings");
    if (pathname.startsWith("/teams-and-services/services")) return title("Services");
    if (pathname.startsWith("/teams-and-services/qualifications")) return title("Qualifications");
    if (pathname.startsWith("/teams-and-services/roles")) return title("Team Roles");
    if (pathname.startsWith("/teams-and-services/microphones")) return title("Microphones");
    if (pathname.startsWith("/teams-and-services/service-setup")) return title("Service Setup");
    return title("Teams & Services");
  }
  if (pathname.startsWith("/teams/intake")) return title("Team Intake");
  if (pathname.startsWith("/teams/schedule")) return title("Team Schedule");
  if (pathname.startsWith("/schedule-response")) return title("Schedule Response");
  if (pathname.startsWith("/services/")) return title("Shared Service");
  if (pathname === "/boards/controller") return title("Board Controller");
  if (pathname === "/boards/display") return title("Board Display");
  if (pathname.startsWith("/boards/present/")) return title("Board Presentation");
  if (pathname.startsWith("/boards/")) return title("Board");
  if (pathname === "/projector") return title("Projector");
  if (pathname === "/projector-full") return title("Projector Full");
  if (pathname === "/monitor") return title("Monitor");
  if (pathname === "/stream") return title("Stream");
  if (pathname === "/stream-info") return title("Stream Info");
  if (pathname === "/credits") return title("Credits");
  if (pathname === "/credits-editor") return title("Credits Editor");

  return APP_TITLE;
};
