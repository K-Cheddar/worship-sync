export const registerVolunteerRoutes = (app, authHandlers) => {
  app.get(
    "/api/churches/:churchId/my-team-assignments",
    authHandlers.getMyTeamAssignments,
  );
  // Self-scoped: resolves the member from the session, not a :memberId, so a
  // schedule-only volunteer can maintain their own availability without any
  // teams permission.
  app.post(
    "/api/churches/:churchId/my-blockout-dates",
    authHandlers.updateMyBlockoutDates,
  );
  // Also self-scoped: the slot must be held by the session's own member.
  app.post(
    "/api/churches/:churchId/my-assignments/respond",
    authHandlers.respondToMyAssignment,
  );
  app.post(
    "/api/churches/:churchId/my-assignments/accept-unanswered",
    authHandlers.acceptMyUnansweredAssignments,
  );
  app.get(
    "/api/churches/:churchId/my-availability",
    authHandlers.getMyVolunteerAvailability,
  );
  app.post(
    "/api/churches/:churchId/my-availability",
    authHandlers.submitMyVolunteerAvailability,
  );
  // The handler gate defaults to disabled until the complete portal is verified.
  app.use("/s", (_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    next();
  });
  app.post("/api/volunteer/redeem", authHandlers.redeemVolunteerPersonalAccess);
  app.post("/api/volunteer/recovery/start", authHandlers.startVolunteerRecovery);
  app.post("/api/volunteer/recovery/verify", authHandlers.verifyVolunteerRecovery);
  app.get("/api/volunteer/session", authHandlers.getVolunteerPersonalSession);
  app.get("/api/volunteer/schedule", authHandlers.getVolunteerPersonalSchedule);
  app.post("/api/volunteer/respond", authHandlers.respondToVolunteerPersonalAssignment);
  app.post("/api/volunteer/accept-unanswered", authHandlers.acceptVolunteerPersonalUnanswered);
  app.post("/api/volunteer/blockouts", authHandlers.saveVolunteerPersonalBlockouts);
  app.get("/api/volunteer/availability", authHandlers.getVolunteerPersonalAvailability);
  app.post("/api/volunteer/availability", authHandlers.submitVolunteerPersonalAvailability);
  app.post("/api/churches/:churchId/team-roster-members/:memberId/personal-access/prepare", authHandlers.prepareVolunteerPersonalAccess);
  app.get("/api/churches/:churchId/team-roster-members/:memberId/personal-access/status", authHandlers.getVolunteerPersonalAccessStatus);
  app.post("/api/churches/:churchId/team-roster-members/:memberId/personal-access/replace", authHandlers.replaceVolunteerPersonalAccess);
  app.post("/api/churches/:churchId/team-roster-members/:memberId/personal-access/revoke", authHandlers.revokeVolunteerPersonalAccess);
  app.post("/api/churches/:churchId/team-roster-members/:memberId/personal-access/restore", authHandlers.restoreVolunteerPersonalAccess);
  app.post("/api/churches/:churchId/team-roster-members/:memberId/personal-access/verify-contact/start", authHandlers.startVolunteerContactVerification);
  app.post("/api/churches/:churchId/team-roster-members/:memberId/personal-access/verify-contact/complete", authHandlers.verifyVolunteerContact);
};
