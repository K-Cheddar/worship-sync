import crypto from "node:crypto";

const APP_BASE_URL =
  process.env.AUTH_APP_BASE_URL?.replace(/\/$/, "") ||
  "https://www.worshipsync.net";

const teamIntakeTokenSecret =
  process.env.AUTH_TEAM_INTAKE_TOKEN_SECRET ||
  process.env.AUTH_SESSION_SECRET ||
  "dev-auth-secret";

// Upper bound for a single church's per-collection bootstrap query. Sized to
// cover realistic roster/submission growth while still bounding Firestore reads.
const TEAM_COLLECTION_QUERY_LIMIT = 5000;

export const createTeamsAuthHandlers = ({
  COLLECTIONS,
  addSecurityEvent,
  assertCsrf,
  createId,
  deleteDoc,
  enforceRateLimit,
  getClientIp,
  getDoc,
  hashValue,
  httpError,
  nowIso,
  queryDocs,
  randomSecret,
  readChurchPublicBoardHeaderLogoUrl,
  requireAdminSession,
  requireTeamsEditSession,
  requireTeamsEditForTeamSession,
  requireTeamsViewSession,
  requireFirestore,
  setDoc,
}) => {
  const requireTeamsEdit = requireTeamsEditSession || requireAdminSession;
  const requireTeamsEditForTeam =
    requireTeamsEditForTeamSession ||
    ((req, churchId) => requireTeamsEdit(req, churchId));
  const requireTeamsView = requireTeamsViewSession || requireAdminSession;

  const sendTeamsJsonError = (res, error, fallbackMessage) => {
    const statusCode =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400
        ? error.statusCode
        : 500;
    if (statusCode >= 500) {
      console.error(fallbackMessage, error);
    }
    return res.status(statusCode).json({
      success: false,
      errorMessage:
        statusCode < 500 && error?.message ? error.message : fallbackMessage,
    });
  };

  const buildPublicTokenRateLimitKey = (req, token) => {
    const tokenText = String(token || "").trim();
    return `${getClientIp(req)}:${tokenText ? hashValue(tokenText) : "missing-token"}`;
  };

  const enforcePublicTokenRateLimit = ({
    req,
    scope,
    token,
    limit,
    windowMs,
    blockMs,
  }) =>
    enforceRateLimit({
      scope,
      key: buildPublicTokenRateLimitKey(req, token),
      limit,
      windowMs,
      blockMs,
    });

  const buildTeamIntakePublicUrl = (token) =>
    `${APP_BASE_URL}/#/teams/intake/${encodeURIComponent(String(token || "").trim())}`;

  const TEAM_ENTITY_CONFIG = {
    member: {
      collection: COLLECTIONS.teamRosterMembers,
      idField: "memberId",
      idPrefix: "teamMember",
    },
    position: {
      collection: COLLECTIONS.teamPositions,
      idField: "positionId",
      idPrefix: "teamPosition",
    },
    team: {
      collection: COLLECTIONS.teams,
      idField: "teamId",
      idPrefix: "team",
    },
    role: {
      collection: COLLECTIONS.teamRoles,
      idField: "roleId",
      idPrefix: "teamRole",
    },
    qualificationArea: {
      collection: COLLECTIONS.teamQualificationAreas,
      idField: "areaId",
      idPrefix: "teamQualificationArea",
    },
    qualificationLevel: {
      collection: COLLECTIONS.teamQualificationLevels,
      idField: "levelId",
      idPrefix: "teamQualificationLevel",
    },
    schedule: {
      collection: COLLECTIONS.teamSchedules,
      idField: "scheduleId",
      idPrefix: "teamSchedule",
    },
  };

  const normalizeShortText = (value, { max = 160 } = {}) =>
    String(value || "")
      .trim()
      .slice(0, max);

  const normalizeLongText = (value, { max = 2000 } = {}) =>
    String(value || "")
      .trim()
      .slice(0, max);

  const normalizeIdArray = (value) =>
    Array.from(
      new Set(
        (Array.isArray(value) ? value : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    );

  const assertPlainDate = (value, fieldLabel) => {
    const date = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw httpError(400, `${fieldLabel} must be a valid date.`);
    }
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw httpError(400, `${fieldLabel} must be a valid date.`);
    }
    return date;
  };

  const normalizeOptionalPlainDate = (value, fieldLabel) => {
    const date = String(value || "").trim();
    return date ? assertPlainDate(date, fieldLabel) : "";
  };

  const assertTeamScheduleDateTime = (value, fieldLabel) => {
    const dateTime = String(value || "").trim();
    if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) {
      throw httpError(400, `${fieldLabel} must be a valid date and time.`);
    }
    return dateTime;
  };

  const normalizeBlockoutDates = (value) => {
    const ranges = Array.isArray(value) ? value : [];
    return ranges
      .map((range) => {
        const startDate = normalizeOptionalPlainDate(
          range?.startDate,
          "Blockout start date",
        );
        const endDate = normalizeOptionalPlainDate(
          range?.endDate,
          "Blockout end date",
        );
        if (!startDate && !endDate) return null;
        const normalizedStart = startDate || endDate;
        const normalizedEnd = endDate || startDate;
        if (normalizedStart > normalizedEnd) {
          throw httpError(
            400,
            "Blockout end date must be after the start date.",
          );
        }
        return {
          startDate: normalizedStart,
          endDate: normalizedEnd,
          notes: normalizeLongText(range?.notes, { max: 500 }),
        };
      })
      .filter(Boolean);
  };

  const getTeamEntity = async (kind, id) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const trimmedId = String(id || "").trim();
    if (!config || !trimmedId) return null;
    const doc = await getDoc(config.collection, trimmedId);
    return doc ? { [config.idField]: doc.id, ...doc } : null;
  };

  const assertTeamEntityInChurch = async (
    kind,
    id,
    churchId,
    { active = true, label } = {},
  ) => {
    const entity = await getTeamEntity(kind, id);
    const entityLabel = label || kind;
    if (!entity || entity.churchId !== churchId) {
      throw httpError(404, `${entityLabel} not found.`);
    }
    if (active && entity.archivedAt) {
      throw httpError(400, `${entityLabel} is archived.`);
    }
    return entity;
  };

  const assertTeamEntityIdsInChurch = async (
    kind,
    ids,
    churchId,
    { label, active = true, assertEntity } = {},
  ) => {
    const normalizedIds = normalizeIdArray(ids);
    await Promise.all(
      normalizedIds.map(async (id) => {
        const entity = await assertTeamEntityInChurch(kind, id, churchId, {
          active,
          label,
        });
        if (assertEntity) assertEntity(entity);
      }),
    );
    return normalizedIds;
  };

  const collectMemberTeamIds = async (member, churchId) => {
    const teamIds = new Set();
    Object.keys(member?.teamMemberships || {}).forEach((teamId) => {
      if (teamId) teamIds.add(teamId);
    });
    (member?.qualifications || []).forEach((qualification) => {
      if (qualification?.teamId) teamIds.add(qualification.teamId);
    });
    await Promise.all(
      (member?.positionIds || []).map(async (positionId) => {
        const position = await assertTeamEntityInChurch(
          "position",
          positionId,
          churchId,
          { label: "Position", active: false },
        );
        if (position.teamId) teamIds.add(position.teamId);
      }),
    );
    return Array.from(teamIds);
  };

  const requireTeamsEditForTeamIds = async (req, churchId, teamIds) => {
    const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));
    if (uniqueTeamIds.length === 0) {
      return requireTeamsEdit(req, churchId);
    }
    let admin = null;
    for (const teamId of uniqueTeamIds) {
      admin = await requireTeamsEditForTeam(req, churchId, teamId);
    }
    return admin;
  };

  const requireTeamsEditForMember = async (req, churchId, member) =>
    requireTeamsEditForTeamIds(
      req,
      churchId,
      await collectMemberTeamIds(member, churchId),
    );

  const addMemberToTeamsForPositions = async ({
    churchId,
    positionIds,
    memberId,
    adminUserId,
  }) => {
    const normalizedPositionIds = normalizeIdArray(positionIds);
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    if (!normalizedMemberId || normalizedPositionIds.length === 0) return [];
    const positions = await Promise.all(
      normalizedPositionIds.map((positionId) =>
        assertTeamEntityInChurch("position", positionId, churchId, {
          label: "Position",
        }),
      ),
    );
    const teamIds = Array.from(
      new Set(positions.map((position) => position.teamId).filter(Boolean)),
    );
    const now = nowIso();
    await Promise.all(
      teamIds.map(async (teamId) => {
        const team = await assertTeamEntityInChurch("team", teamId, churchId, {
          label: "Team",
        });
        if ((team.memberIds || []).includes(normalizedMemberId)) return;
        await setDoc(
          COLLECTIONS.teams,
          teamId,
          {
            memberIds: [...(team.memberIds || []), normalizedMemberId],
            updatedAt: now,
            updatedByUid: adminUserId,
          },
          { merge: true },
        );
      }),
    );
    return teamIds;
  };

  const listTeamCollectionForChurch = async (
    collectionName,
    idField,
    churchId,
    { truncatedCollections } = {},
  ) => {
    const docs = await queryDocs(
      collectionName,
      [{ field: "churchId", value: churchId }],
      { limit: TEAM_COLLECTION_QUERY_LIMIT },
    );
    // A full page back means there may be more rows we silently dropped. Surface
    // it so a church outgrowing the cap is observable instead of quietly losing
    // members, submissions, etc. from the admin view.
    if (docs.length >= TEAM_COLLECTION_QUERY_LIMIT) {
      console.warn(
        `Teams: ${collectionName} returned the ${TEAM_COLLECTION_QUERY_LIMIT}-row query cap for church ${churchId}; results may be truncated.`,
      );
      // Let the caller (the bootstrap) tell the admin their view is incomplete.
      if (truncatedCollections) truncatedCollections.push(collectionName);
    }
    return docs
      .map((doc) => ({
        [idField]: doc.id,
        ...doc,
      }))
      .sort(
        (a, b) =>
          new Date(a.createdAt || 0).getTime() -
          new Date(b.createdAt || 0).getTime(),
      );
  };

  // Positions carry an explicit `order` so admins can arrange them; the schedule
  // columns follow this same order. Positions without an order (legacy/just
  // created) fall back to creation order, which is how they already arrive here.
  const sortPositionsByOrder = (positions) =>
    [...positions].sort((a, b) => {
      const orderA = Number.isFinite(a?.order)
        ? a.order
        : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b?.order)
        ? b.order
        : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  // Next order index for a newly created position: append after the team's
  // current positions so new positions land at the end.
  const nextPositionOrder = async (churchId, teamId) => {
    const positions = await listTeamCollectionForChurch(
      COLLECTIONS.teamPositions,
      "positionId",
      churchId,
    );
    const orders = positions
      .filter((position) => position.teamId === teamId)
      .map((position) =>
        Number.isFinite(position.order) ? position.order : -1,
      );
    return Math.max(-1, ...orders) + 1;
  };

  const sanitizeTeamIntakeFormForAdmin = (form, submissionCount = 0) => {
    const {
      publicTokenHash,
      publicTokenNonce,
      publicLinkToken,
      ...clientForm
    } = form || {};
    return {
      ...clientForm,
      submissionCount,
      ...(publicLinkToken
        ? { publicUrl: buildTeamIntakePublicUrl(publicLinkToken) }
        : {}),
    };
  };

  const buildTeamsBootstrap = async (churchId) => {
    // Collects any collection that hit the row cap so we can warn the admin their
    // view is incomplete instead of silently showing a partial roster/schedule.
    const truncatedCollections = [];
    const [
      members,
      positions,
      teams,
      teamRoles,
      qualificationAreas,
      qualificationLevels,
      schedules,
      rawIntakeForms,
      intakeSubmissions,
    ] = await Promise.all([
      listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamPositions,
        "positionId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(COLLECTIONS.teams, "teamId", churchId, {
        truncatedCollections,
      }),
      listTeamCollectionForChurch(COLLECTIONS.teamRoles, "roleId", churchId, {
        truncatedCollections,
      }),
      listTeamCollectionForChurch(
        COLLECTIONS.teamQualificationAreas,
        "areaId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamQualificationLevels,
        "levelId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamSchedules,
        "scheduleId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamIntakeForms,
        "formId",
        churchId,
        { truncatedCollections },
      ),
      listTeamCollectionForChurch(
        COLLECTIONS.teamIntakeSubmissions,
        "submissionId",
        churchId,
        { truncatedCollections },
      ),
    ]);
    const submissionCountByForm = new Map();
    intakeSubmissions.forEach((submission) => {
      submissionCountByForm.set(
        submission.formId,
        (submissionCountByForm.get(submission.formId) || 0) + 1,
      );
    });
    const intakeForms = rawIntakeForms.map((form) =>
      sanitizeTeamIntakeFormForAdmin(
        form,
        submissionCountByForm.get(form.formId) || 0,
      ),
    );
    return {
      members,
      positions: sortPositionsByOrder(positions),
      teams,
      teamRoles,
      qualificationAreas,
      qualificationLevels,
      schedules,
      intakeForms,
      intakeSubmissions,
      ...(truncatedCollections.length > 0 ? { truncated: true } : {}),
    };
  };

  const sanitizePositionRequirements = (value) => {
    const byPosition = new Map();
    (Array.isArray(value) ? value : []).forEach((req) => {
      const positionId = normalizeShortText(req?.positionId, { max: 160 });
      const count = Math.floor(Number(req?.count));
      if (!positionId || !Number.isFinite(count) || count < 1) return;
      const minLevelId = normalizeShortText(req?.minLevelId, { max: 160 });
      byPosition.set(positionId, {
        positionId,
        count,
        ...(minLevelId ? { minLevelId } : {}),
      });
    });
    return [...byPosition.values()];
  };

  const normalizeTeamMemberships = async (value, churchId) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, rawMembership]) => {
        const teamId = normalizeShortText(rawMembership?.teamId || key, {
          max: 160,
        });
        if (!teamId) return null;
        await assertTeamEntityInChurch("team", teamId, churchId, {
          label: "Team",
        });
        const roleId = normalizeShortText(rawMembership?.roleId, { max: 160 });
        const roleLabel = normalizeShortText(rawMembership?.roleLabel, {
          max: 120,
        });
        if (roleId) {
          const role = await assertTeamEntityInChurch(
            "role",
            roleId,
            churchId,
            {
              label: "Team role",
            },
          );
          if (role.teamId !== teamId) {
            throw httpError(400, "Team role must belong to the selected team.");
          }
        }
        return [
          teamId,
          {
            teamId,
            ...(roleId ? { roleId } : {}),
            ...(roleLabel ? { roleLabel } : {}),
            notes: normalizeLongText(rawMembership?.notes, { max: 500 }),
          },
        ];
      }),
    );
    return Object.fromEntries(entries.filter(Boolean));
  };

  const normalizeTeamMemberQualifications = async (value, churchId) => {
    const rows = Array.isArray(value) ? value : [];
    const normalized = await Promise.all(
      rows.map(async (rawQualification) => {
        const areaId = normalizeShortText(rawQualification?.areaId, {
          max: 160,
        });
        if (!areaId) return null;
        const area = await assertTeamEntityInChurch(
          "qualificationArea",
          areaId,
          churchId,
          { label: "Qualification area" },
        );
        const levelId = normalizeShortText(rawQualification?.levelId, {
          max: 160,
        });
        if (levelId) {
          const level = await assertTeamEntityInChurch(
            "qualificationLevel",
            levelId,
            churchId,
            { label: "Qualification level" },
          );
          if (level.areaId !== areaId) {
            throw httpError(
              400,
              "Qualification level must belong to the selected area.",
            );
          }
        }
        const teamId = normalizeShortText(rawQualification?.teamId, {
          max: 160,
        });
        if (teamId) {
          await assertTeamEntityInChurch("team", teamId, churchId, {
            label: "Team",
          });
          if (area.teamId !== teamId) {
            throw httpError(
              400,
              "Qualification area must belong to the selected team.",
            );
          }
        }
        const statusValues = new Set(["in_training", "completed", "expired"]);
        const status = statusValues.has(rawQualification?.status)
          ? rawQualification.status
          : "in_training";
        return {
          qualificationId:
            normalizeShortText(rawQualification?.qualificationId, {
              max: 160,
            }) || createId("memberQualification"),
          areaId,
          ...(levelId ? { levelId } : {}),
          teamId: teamId || area.teamId,
          status,
          completedAt: normalizeOptionalPlainDate(
            rawQualification?.completedAt,
            "Qualification completion date",
          ),
          expiresAt: normalizeOptionalPlainDate(
            rawQualification?.expiresAt,
            "Qualification expiration date",
          ),
          verifiedByUid: normalizeShortText(rawQualification?.verifiedByUid, {
            max: 160,
          }),
          notes: normalizeLongText(rawQualification?.notes, { max: 500 }),
        };
      }),
    );
    return normalized.filter(Boolean);
  };

  const validateTeamMemberPayload = async (body, churchId) => {
    const firstName = normalizeShortText(body?.firstName, { max: 80 });
    const lastName = normalizeShortText(body?.lastName, { max: 80 });
    if (!firstName) {
      throw httpError(400, "First name is required.");
    }
    if (!lastName) {
      throw httpError(400, "Last name is required.");
    }
    const dateOfBirth = normalizeOptionalPlainDate(
      body?.dateOfBirth,
      "Date of birth",
    );
    const positionIds = await assertTeamEntityIdsInChurch(
      "position",
      body?.positionIds,
      churchId,
      { label: "Position" },
    );
    const payload = {
      firstName,
      lastName,
      dateOfBirth,
      positionIds,
      blockoutDates: normalizeBlockoutDates(body?.blockoutDates),
      notes: normalizeLongText(body?.notes),
    };
    if (Object.prototype.hasOwnProperty.call(body || {}, "teamMemberships")) {
      payload.teamMemberships = await normalizeTeamMemberships(
        body?.teamMemberships,
        churchId,
      );
    }
    if (Object.prototype.hasOwnProperty.call(body || {}, "qualifications")) {
      payload.qualifications = await normalizeTeamMemberQualifications(
        body?.qualifications,
        churchId,
      );
    }
    return payload;
  };

  const validateTeamPositionPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name);
    if (!name) {
      throw httpError(400, "Position name is required.");
    }
    // Positions are owned by a team; the team must exist in this church.
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    return {
      name,
      description: normalizeLongText(body?.description),
      icon: normalizeShortText(body?.icon, { max: 40 }),
      groupId: normalizeShortText(body?.groupId, { max: 160 }) || null,
      teamId: team.teamId,
    };
  };

  const validateTeamPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name);
    if (!name) {
      throw httpError(400, "Team name is required.");
    }
    const memberIds = await assertTeamEntityIdsInChurch(
      "member",
      body?.memberIds,
      churchId,
      { label: "Member" },
    );
    // Positions are owned by the team (position.teamId), not selected onto it, so
    // a team's positions are derived.
    return {
      name,
      description: normalizeLongText(body?.description),
      icon: normalizeShortText(body?.icon, { max: 40 }),
      memberIds,
    };
  };

  const validateTeamRolePayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name, { max: 120 });
    if (!name) {
      throw httpError(400, "Role name is required.");
    }
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    return {
      teamId: team.teamId,
      name,
      description: normalizeLongText(body?.description),
    };
  };

  const validateQualificationAreaPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name, { max: 120 });
    if (!name) {
      throw httpError(400, "Qualification area name is required.");
    }
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    return {
      teamId: team.teamId,
      name,
      description: normalizeLongText(body?.description),
    };
  };

  const validateQualificationLevelPayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name, { max: 120 });
    if (!name) {
      throw httpError(400, "Qualification level name is required.");
    }
    const area = await assertTeamEntityInChurch(
      "qualificationArea",
      body?.areaId,
      churchId,
      { label: "Qualification area" },
    );
    const rank = Number(body?.rank);
    if (!Number.isFinite(rank)) {
      throw httpError(400, "Qualification level rank is required.");
    }
    return {
      areaId: area.areaId,
      name,
      description: normalizeLongText(body?.description),
      rank,
    };
  };

  const normalizeTeamScheduleOccurrences = (value, serviceIds) => {
    const occurrences = Array.isArray(value) ? value : [];
    if (occurrences.length === 0) {
      throw httpError(400, "At least one service occurrence is required.");
    }
    const serviceIdSet = new Set(serviceIds);
    const seen = new Set();
    return occurrences.map((occurrence) => {
      const occurrenceId = normalizeShortText(occurrence?.occurrenceId, {
        max: 260,
      });
      const serviceId = normalizeShortText(occurrence?.serviceId, { max: 160 });
      if (!occurrenceId) {
        throw httpError(400, "Service occurrence id is required.");
      }
      if (seen.has(occurrenceId)) {
        throw httpError(400, "Service occurrence ids must be unique.");
      }
      seen.add(occurrenceId);
      if (!serviceIdSet.has(serviceId)) {
        throw httpError(
          400,
          "Service occurrence must reference a selected service.",
        );
      }
      return {
        occurrenceId,
        serviceId,
        name: normalizeShortText(occurrence?.name),
        startsAt: assertTeamScheduleDateTime(
          occurrence?.startsAt,
          "Service occurrence date",
        ),
        positionRequirements: sanitizePositionRequirements(
          occurrence?.positionRequirements,
        ),
      };
    });
  };

  const normalizeTeamScheduleAttendance = ({
    value,
    occurrenceIds,
    teamMemberIds,
  }) => {
    const rawAttendance = value && typeof value === "object" ? value : {};
    const occurrenceIdSet = new Set(occurrenceIds);
    const teamMemberIdSet = new Set(teamMemberIds || []);
    const attendance = {};
    for (const [occurrenceId, row] of Object.entries(rawAttendance)) {
      if (
        !occurrenceIdSet.has(occurrenceId) ||
        !row ||
        typeof row !== "object"
      ) {
        continue;
      }
      for (const [memberId, rawEntry] of Object.entries(row)) {
        const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
        if (!teamMemberIdSet.has(normalizedMemberId)) continue;
        const status =
          rawEntry?.status === "present" || rawEntry?.status === "absent"
            ? rawEntry.status
            : "";
        if (!status) continue;
        const columnKey = normalizeShortText(rawEntry?.columnKey, { max: 180 });
        const positionId = normalizeShortText(rawEntry?.positionId, {
          max: 160,
        });
        const positionLabel = normalizeShortText(rawEntry?.positionLabel, {
          max: 160,
        });
        const updatedAt = normalizeShortText(rawEntry?.updatedAt, { max: 80 });
        if (!attendance[occurrenceId]) attendance[occurrenceId] = {};
        attendance[occurrenceId][normalizedMemberId] = {
          status,
          ...(columnKey ? { columnKey } : {}),
          ...(positionId ? { positionId } : {}),
          ...(positionLabel ? { positionLabel } : {}),
          ...(updatedAt ? { updatedAt } : {}),
        };
      }
    }
    return attendance;
  };

  // Apply a single attendance change to a schedule's attendance map. Used by the
  // dedicated attendance endpoint so marking one person present/absent merges a
  // single cell instead of re-PUTting the whole schedule (which races with other
  // editors). Returns the next attendance object; throws on invalid input.
  const buildNextScheduleAttendance = ({
    schedule,
    team,
    occurrenceId,
    memberId,
    status,
    columnKey,
    positionId,
    positionLabel,
  }) => {
    const normalizedOccurrenceId = normalizeShortText(occurrenceId, {
      max: 180,
    });
    if (!normalizedOccurrenceId) {
      throw httpError(400, "Occurrence is required.");
    }
    const occurrenceIds = new Set(
      (schedule.occurrences || []).map((occurrence) => occurrence.occurrenceId),
    );
    if (!occurrenceIds.has(normalizedOccurrenceId)) {
      throw httpError(404, "Occurrence not found on this schedule.");
    }
    const normalizedMemberId = normalizeShortText(memberId, { max: 160 });
    if (!normalizedMemberId) {
      throw httpError(400, "Member is required.");
    }
    if (!(team.memberIds || []).includes(normalizedMemberId)) {
      throw httpError(400, "That member is not part of this team.");
    }
    const normalizedStatus =
      status === "present" || status === "absent" ? status : "";

    const attendance = { ...(schedule.attendance || {}) };
    const row = { ...(attendance[normalizedOccurrenceId] || {}) };
    if (normalizedStatus) {
      const normalizedColumnKey = normalizeShortText(columnKey, { max: 180 });
      const normalizedPositionId = normalizeShortText(positionId, { max: 160 });
      const normalizedPositionLabel = normalizeShortText(positionLabel, {
        max: 160,
      });
      row[normalizedMemberId] = {
        status: normalizedStatus,
        ...(normalizedColumnKey ? { columnKey: normalizedColumnKey } : {}),
        ...(normalizedPositionId ? { positionId: normalizedPositionId } : {}),
        ...(normalizedPositionLabel
          ? { positionLabel: normalizedPositionLabel }
          : {}),
        updatedAt: nowIso(),
      };
    } else {
      // An empty status clears the mark.
      delete row[normalizedMemberId];
    }
    if (Object.keys(row).length > 0) {
      attendance[normalizedOccurrenceId] = row;
    } else {
      delete attendance[normalizedOccurrenceId];
    }
    return attendance;
  };

  const validateTeamScheduleAttendanceUpdatePayload = (body) => {
    const occurrenceId = normalizeShortText(body?.occurrenceId, { max: 180 });
    if (!occurrenceId) {
      throw httpError(400, "Occurrence is required.");
    }
    const memberId = normalizeShortText(body?.memberId, { max: 160 });
    if (!memberId) {
      throw httpError(400, "Member is required.");
    }
    const status = normalizeShortText(body?.status, { max: 40 });
    if (status && status !== "present" && status !== "absent") {
      throw httpError(400, "Attendance status must be present or absent.");
    }
    return {
      occurrenceId,
      memberId,
      status,
      columnKey: normalizeShortText(body?.columnKey, { max: 180 }),
      positionId: normalizeShortText(body?.positionId, { max: 160 }),
      positionLabel: normalizeShortText(body?.positionLabel, { max: 160 }),
    };
  };

  const validateTeamSchedulePayload = async (body, churchId) => {
    const name = normalizeShortText(body?.name);
    if (!name) {
      throw httpError(400, "Schedule name is required.");
    }
    const team = await assertTeamEntityInChurch(
      "team",
      body?.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    const serviceIds = normalizeIdArray(body?.serviceIds);
    if (serviceIds.length === 0) {
      throw httpError(400, "At least one service is required.");
    }
    const startDate = assertPlainDate(body?.startDate, "Schedule start date");
    const endDate = assertPlainDate(body?.endDate, "Schedule end date");
    if (startDate > endDate) {
      throw httpError(400, "Schedule end date must be after the start date.");
    }
    const occurrences = normalizeTeamScheduleOccurrences(
      body?.occurrences,
      serviceIds,
    );
    const occurrenceIds = occurrences.map(
      (occurrence) => occurrence.occurrenceId,
    );
    const assignments = {};
    const rawAssignments =
      body?.assignments && typeof body.assignments === "object"
        ? body.assignments
        : {};
    for (const occurrenceId of occurrenceIds) {
      const row = rawAssignments[occurrenceId];
      if (!row || typeof row !== "object") continue;
      // Sanitize each provided cell by its explicit slot key. Per-assignment position/member
      // validation happens on the dedicated assignment endpoint.
      for (const [cellKey, rawCell] of Object.entries(row)) {
        if (!parseScheduleSlotKey(cellKey)) continue;
        const cell = normalizeScheduleAssignmentCell(rawCell);
        const nextCell = serializeScheduleAssignmentCell(cell);
        if (nextCell) {
          if (!assignments[occurrenceId]) assignments[occurrenceId] = {};
          assignments[occurrenceId][cellKey] = nextCell;
        }
      }
    }
    const attendance = normalizeTeamScheduleAttendance({
      value: body?.attendance,
      occurrenceIds,
      teamMemberIds: team.memberIds || [],
    });
    return {
      name,
      description: normalizeLongText(body?.description),
      teamId: team.teamId,
      startDate,
      endDate,
      serviceIds,
      occurrences,
      assignments,
      attendance,
    };
  };

  const upsertTeamEntity = async ({
    kind,
    churchId,
    id,
    payload,
    adminUserId,
  }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const now = nowIso();
    const nextId = id || createId(config.idPrefix);
    if (id) {
      await assertTeamEntityInChurch(kind, id, churchId, {
        active: false,
        label: kind,
      });
    }
    const doc = {
      ...payload,
      [config.idField]: nextId,
      churchId,
      archivedAt: null,
      updatedAt: now,
      updatedByUid: adminUserId,
      ...(id
        ? {}
        : {
            createdAt: now,
            createdByUid: adminUserId,
          }),
    };
    await setDoc(config.collection, nextId, doc, { merge: Boolean(id) });
    return {
      [config.idField]: nextId,
      ...(await getDoc(config.collection, nextId)),
    };
  };

  const archiveTeamEntity = async ({ kind, churchId, id, adminUserId }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    const entity = await assertTeamEntityInChurch(kind, id, churchId, {
      active: false,
      label: kind,
    });
    if (!entity.archivedAt) {
      await setDoc(
        config.collection,
        id,
        {
          archivedAt: nowIso(),
          archivedByUid: adminUserId,
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
    }
  };

  // Keep references consistent after a permanent deletion:
  //  - team: delete its owned positions (each position cascade scrubs members/assignments),
  //          roles, and qualification areas;
  //          schedules that reference the team are intentionally left orphaned.
  //  - member: remove from team rosters + schedule assignments.
  //  - position: remove from members' positionIds + schedule assignments.
  //  - role/qualification metadata: remove only guidance labels, not scheduling history.
  const cascadeTeamEntityDeletion = async ({
    kind,
    churchId,
    id,
    adminUserId,
  }) => {
    const touch = { updatedAt: nowIso(), updatedByUid: adminUserId };

    if (kind === "team") {
      const [positions, roles, areas] = await Promise.all([
        listTeamCollectionForChurch(
          COLLECTIONS.teamPositions,
          "positionId",
          churchId,
        ),
        listTeamCollectionForChurch(COLLECTIONS.teamRoles, "roleId", churchId),
        listTeamCollectionForChurch(
          COLLECTIONS.teamQualificationAreas,
          "areaId",
          churchId,
        ),
      ]);
      await Promise.all([
        ...positions
          .filter((position) => position.teamId === id)
          .map((position) =>
            deleteTeamEntity({
              kind: "position",
              churchId,
              id: position.positionId,
              adminUserId,
            }),
          ),
        ...roles
          .filter((role) => role.teamId === id)
          .map((role) =>
            deleteTeamEntity({
              kind: "role",
              churchId,
              id: role.roleId,
              adminUserId,
            }),
          ),
        ...areas
          .filter((area) => area.teamId === id)
          .map((area) =>
            deleteTeamEntity({
              kind: "qualificationArea",
              churchId,
              id: area.areaId,
              adminUserId,
            }),
          ),
      ]);
      return;
    }

    if (kind === "qualificationArea") {
      const levels = await listTeamCollectionForChurch(
        COLLECTIONS.teamQualificationLevels,
        "levelId",
        churchId,
      );
      await Promise.all(
        levels
          .filter((level) => level.areaId === id)
          .map((level) =>
            deleteTeamEntity({
              kind: "qualificationLevel",
              churchId,
              id: level.levelId,
              adminUserId,
            }),
          ),
      );
    }

    if (
      kind !== "member" &&
      kind !== "position" &&
      kind !== "role" &&
      kind !== "qualificationArea" &&
      kind !== "qualificationLevel"
    )
      return;

    if (kind === "member") {
      const teams = await listTeamCollectionForChurch(
        COLLECTIONS.teams,
        "teamId",
        churchId,
      );
      await Promise.all(
        teams.map(async (team) => {
          const memberIds = team.memberIds || [];
          const nextMemberIds = memberIds.filter((mid) => mid !== id);
          if (nextMemberIds.length === memberIds.length) return;
          await setDoc(
            COLLECTIONS.teams,
            team.teamId,
            { memberIds: nextMemberIds, ...touch },
            { merge: true },
          );
        }),
      );
    }

    if (kind === "position") {
      const members = await listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
      );
      await Promise.all(
        members.map(async (member) => {
          const positionIds = member.positionIds || [];
          if (!positionIds.includes(id)) return;
          await setDoc(
            COLLECTIONS.teamRosterMembers,
            member.memberId,
            { positionIds: positionIds.filter((pid) => pid !== id), ...touch },
            { merge: true },
          );
        }),
      );
    }

    if (
      kind === "role" ||
      kind === "qualificationArea" ||
      kind === "qualificationLevel"
    ) {
      const members = await listTeamCollectionForChurch(
        COLLECTIONS.teamRosterMembers,
        "memberId",
        churchId,
      );
      await Promise.all(
        members.map(async (member) => {
          let changed = false;
          let nextTeamMemberships = member.teamMemberships || {};
          let nextQualifications = member.qualifications || [];

          if (kind === "role") {
            nextTeamMemberships = Object.fromEntries(
              Object.entries(nextTeamMemberships).map(
                ([teamId, membership]) => {
                  if (membership?.roleId !== id) return [teamId, membership];
                  changed = true;
                  const { roleId, ...rest } = membership;
                  return [teamId, rest];
                },
              ),
            );
          }

          if (kind === "qualificationArea") {
            const filtered = nextQualifications.filter(
              (qualification) => qualification?.areaId !== id,
            );
            changed = filtered.length !== nextQualifications.length;
            nextQualifications = filtered;
          }

          if (kind === "qualificationLevel") {
            nextQualifications = nextQualifications.map((qualification) => {
              if (qualification?.levelId !== id) return qualification;
              changed = true;
              const { levelId, ...rest } = qualification;
              return rest;
            });
          }

          if (!changed) return;
          await setDoc(
            COLLECTIONS.teamRosterMembers,
            member.memberId,
            {
              teamMemberships: nextTeamMemberships,
              qualifications: nextQualifications,
              ...touch,
            },
            { merge: true },
          );
        }),
      );
    }

    if (
      kind === "role" ||
      kind === "qualificationArea" ||
      kind === "qualificationLevel"
    )
      return;

    const schedules = await listTeamCollectionForChurch(
      COLLECTIONS.teamSchedules,
      "scheduleId",
      churchId,
    );
    await Promise.all(
      schedules.map(async (schedule) => {
        const assignments = schedule.assignments || {};
        const attendance = schedule.attendance || {};
        let changed = false;
        const nextAssignments = {};
        for (const [occurrenceId, row] of Object.entries(assignments)) {
          const nextRow = {};
          for (const [cellKey, cell] of Object.entries(row || {})) {
            // Scrub every slot of the deleted position (e.g. "camera::0" and "camera::1").
            const slot = parseScheduleSlotKey(cellKey);
            if (kind === "position" && slot?.positionId === id) {
              changed = true;
              continue;
            }
            if (kind === "member") {
              // Remove the deleted member from both the primary slot and any
              // shadow, and drop the cell only if nothing is left.
              const normalized = normalizeScheduleAssignmentCell(cell);
              const isPrimary = normalized.primaryMemberId === id;
              const isShadow = normalized.shadows.some(
                (shadow) => shadow.memberId === id,
              );
              if (isPrimary || isShadow) {
                changed = true;
                const nextCell = serializeScheduleAssignmentCell({
                  primaryMemberId: isPrimary ? "" : normalized.primaryMemberId,
                  shadows: normalized.shadows.filter(
                    (shadow) => shadow.memberId !== id,
                  ),
                });
                if (nextCell) {
                  nextRow[cellKey] = nextCell;
                }
                continue;
              }
            }
            nextRow[cellKey] = cell;
          }
          nextAssignments[occurrenceId] = nextRow;
        }
        const nextAttendance = {};
        for (const [occurrenceId, row] of Object.entries(attendance)) {
          const nextRow = { ...(row || {}) };
          if (
            kind === "member" &&
            Object.prototype.hasOwnProperty.call(nextRow, id)
          ) {
            delete nextRow[id];
            changed = true;
          }
          nextAttendance[occurrenceId] = nextRow;
        }
        if (!changed) return;
        await setDoc(
          COLLECTIONS.teamSchedules,
          schedule.scheduleId,
          {
            assignments: nextAssignments,
            attendance: nextAttendance,
            ...touch,
          },
          { merge: true },
        );
      }),
    );
  };

  const deleteTeamEntity = async ({ kind, churchId, id, adminUserId }) => {
    const config = TEAM_ENTITY_CONFIG[kind];
    // Enforce church ownership before permanently removing. Allow deleting
    // archived entities too, so `active: false`.
    await assertTeamEntityInChurch(kind, id, churchId, {
      active: false,
      label: kind,
    });
    await deleteDoc(config.collection, id);
    await cascadeTeamEntityDeletion({ kind, churchId, id, adminUserId });
  };

  const getConcreteTeamServiceDate = (service) => {
    const iso = service?.overrideDateTimeISO || service?.dateTimeISO || "";
    if (iso) return String(iso).slice(0, 10);
    return String(service?.date || "");
  };

  const isMemberUnavailableForService = (member, service) => {
    const serviceDate = getConcreteTeamServiceDate(service);
    if (!serviceDate) return false;
    return (member.blockoutDates || []).some((range) => {
      const start = String(range?.startDate || "");
      const end = String(range?.endDate || start);
      return start <= serviceDate && serviceDate <= end;
    });
  };

  const TEAM_SCHEDULE_SHADOW_KINDS = new Set(["shadow", "reverse_shadow"]);

  const normalizeScheduleAssignmentCell = (cell) => {
    if (!cell || typeof cell !== "object") {
      return { primaryMemberId: "", shadows: [] };
    }
    return {
      primaryMemberId: normalizeShortText(cell.primaryMemberId, { max: 160 }),
      shadows: (Array.isArray(cell.shadows) ? cell.shadows : [])
        .map((shadow) => ({
          memberId: normalizeShortText(shadow?.memberId, { max: 160 }),
          kind: shadow?.kind === "reverse_shadow" ? "reverse_shadow" : "shadow",
        }))
        .filter((shadow) => shadow.memberId),
    };
  };

  const serializeScheduleAssignmentCell = ({ primaryMemberId, shadows }) => {
    const normalizedPrimary = normalizeShortText(primaryMemberId, { max: 160 });
    const normalizedShadows = (Array.isArray(shadows) ? shadows : [])
      .map((shadow) => ({
        memberId: normalizeShortText(shadow?.memberId, { max: 160 }),
        kind: shadow?.kind === "reverse_shadow" ? "reverse_shadow" : "shadow",
      }))
      .filter((shadow) => shadow.memberId);
    if (normalizedShadows.length > 0) {
      return {
        ...(normalizedPrimary ? { primaryMemberId: normalizedPrimary } : {}),
        shadows: normalizedShadows,
      };
    }
    return normalizedPrimary ? { primaryMemberId: normalizedPrimary } : "";
  };

  const normalizePersonNameKey = (firstName, lastName) =>
    `${normalizeShortText(firstName, { max: 80 }).toLowerCase()} ${normalizeShortText(
      lastName,
      { max: 80 },
    ).toLowerCase()}`
      .trim()
      .replace(/\s+/g, " ");

  const normalizeIntakeAvailabilityServices = (value) =>
    (Array.isArray(value) ? value : [])
      .map((service) => {
        const serviceId = normalizeShortText(service?.serviceId, { max: 160 });
        if (!serviceId) return null;
        return {
          serviceId,
          name: normalizeShortText(service?.name) || "Service",
        };
      })
      .filter(Boolean);

  const normalizeIntakeAvailabilityOccurrences = (value) =>
    (Array.isArray(value) ? value : [])
      .map((occurrence) => {
        const occurrenceId = normalizeShortText(occurrence?.occurrenceId, {
          max: 260,
        });
        const serviceId = normalizeShortText(occurrence?.serviceId, {
          max: 160,
        });
        if (!occurrenceId || !serviceId) return null;
        return {
          occurrenceId,
          serviceId,
          name: normalizeShortText(occurrence?.name) || "Service",
          startsAt: assertTeamScheduleDateTime(
            occurrence?.startsAt,
            "Availability service date",
          ),
        };
      })
      .filter(Boolean);

  const validateTeamIntakeFormPayload = (body, existing = null) => {
    const name = normalizeShortText(body?.name ?? existing?.name);
    if (!name) {
      throw httpError(400, "Form name is required.");
    }
    const startDate = assertPlainDate(
      body?.startDate ?? existing?.startDate,
      "Form start date",
    );
    const endDate = assertPlainDate(
      body?.endDate ?? existing?.endDate,
      "Form end date",
    );
    if (startDate > endDate) {
      throw httpError(400, "Form end date must be after the start date.");
    }
    const availabilityServices =
      body?.availabilityServices !== undefined
        ? normalizeIntakeAvailabilityServices(body.availabilityServices)
        : existing?.availabilityServices || [];
    const availabilityOccurrences =
      body?.availabilityOccurrences !== undefined
        ? normalizeIntakeAvailabilityOccurrences(body.availabilityOccurrences)
        : existing?.availabilityOccurrences || [];
    // Teams this form scopes to. Empty means every team in the church. Existence
    // isn't enforced here: the public preview simply shows the positions of
    // whatever teams still exist, so a stale id is harmless and admin-only.
    const teamIds =
      body?.teamIds !== undefined
        ? normalizeIdArray(body.teamIds)
        : existing?.teamIds || [];
    return {
      name,
      startDate,
      endDate,
      availabilityServices,
      availabilityOccurrences,
      teamIds,
      active: Boolean(body?.active ?? existing?.active),
    };
  };

  const normalizeIntakeBlockoutRanges = (value, startDate, endDate) =>
    (Array.isArray(value) ? value : [])
      .map((range) => {
        const start = normalizeOptionalPlainDate(
          range?.startDate,
          "Blockout start date",
        );
        const end = normalizeOptionalPlainDate(
          range?.endDate,
          "Blockout end date",
        );
        if (!start && !end) return null;
        const normalizedStart = start || end;
        const normalizedEnd = end || start;
        if (normalizedStart > normalizedEnd) {
          throw httpError(
            400,
            "Blockout end date must be after the start date.",
          );
        }
        if (normalizedStart < startDate || normalizedEnd > endDate) {
          throw httpError(
            400,
            "Blockout dates must be inside the form period.",
          );
        }
        return { startDate: normalizedStart, endDate: normalizedEnd };
      })
      .filter(Boolean);

  const validateTeamIntakeSubmissionPayload = async (body, form) => {
    const firstName = normalizeShortText(body?.firstName, { max: 80 });
    const lastName = normalizeShortText(body?.lastName, { max: 80 });
    if (!firstName || !lastName) {
      throw httpError(400, "First and last name are required.");
    }
    // The public preview only offers positions from the form's scoped teams
    // (empty teamIds means every team). Enforce that same scope on submission so
    // a crafted POST cannot smuggle in positions from teams outside the form.
    const scopedTeamIds = new Set(form.teamIds || []);
    const positionIds = await assertTeamEntityIdsInChurch(
      "position",
      body?.positionIds,
      form.churchId,
      {
        label: "Position",
        assertEntity: (position) => {
          if (scopedTeamIds.size > 0 && !scopedTeamIds.has(position.teamId)) {
            throw httpError(
              400,
              "One or more selected positions are not available on this form.",
            );
          }
        },
      },
    );
    const occurrenceIds = new Set(
      (form.availabilityOccurrences || []).map(
        (occurrence) => occurrence.occurrenceId,
      ),
    );
    const occurrenceAvailability = {};
    const rawAvailability =
      body?.occurrenceAvailability &&
      typeof body.occurrenceAvailability === "object"
        ? body.occurrenceAvailability
        : {};
    Object.entries(rawAvailability).forEach(([occurrenceId, availability]) => {
      if (!occurrenceIds.has(occurrenceId)) return;
      occurrenceAvailability[occurrenceId] =
        availability === "unavailable" ? "unavailable" : "available";
    });
    return {
      firstName,
      lastName,
      normalizedName: normalizePersonNameKey(firstName, lastName),
      positionIds,
      occurrenceAvailability,
      blockoutRanges: normalizeIntakeBlockoutRanges(
        body?.blockoutRanges,
        form.startDate,
        form.endDate,
      ),
      notes: normalizeLongText(body?.notes, { max: 2000 }),
    };
  };

  const createTeamIntakePublicTokenNonce = () => randomSecret(16);

  const createTeamIntakeShortPublicToken = () =>
    crypto.randomBytes(9).toString("base64url");

  const ensureTeamIntakePublicLinkToken = async (
    formId,
    existing,
    adminUid,
  ) => {
    const storedToken = String(existing?.publicLinkToken || "").trim();
    if (storedToken) {
      return storedToken;
    }
    const publicLinkToken = createTeamIntakeShortPublicToken();
    await setDoc(
      COLLECTIONS.teamIntakeForms,
      formId,
      {
        publicLinkToken,
        publicTokenHash: hashValue(publicLinkToken),
        updatedAt: nowIso(),
        updatedByUid: adminUid,
      },
      { merge: true },
    );
    return publicLinkToken;
  };

  const signTeamIntakePublicToken = (formId, nonce) =>
    crypto
      .createHmac("sha256", teamIntakeTokenSecret)
      .update(`${formId}:${nonce}`)
      .digest("base64url");

  const createTeamIntakePublicToken = (formId, nonce) =>
    `${formId}.${nonce}.${signTeamIntakePublicToken(formId, nonce)}`;

  const isValidTeamIntakePublicToken = (formId, nonce, signature) => {
    const expected = signTeamIntakePublicToken(formId, nonce);
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(String(signature || ""));
    return (
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  };

  const getTeamIntakeFormByToken = async (token) => {
    if (!String(token || "").trim()) {
      throw httpError(404, "Form not found.");
    }
    const [formId, nonce, signature] = String(token).split(".");
    if (formId && nonce && signature) {
      const form = await getDoc(COLLECTIONS.teamIntakeForms, formId);
      if (
        form &&
        !form.archivedAt &&
        form.publicTokenNonce === nonce &&
        isValidTeamIntakePublicToken(formId, nonce, signature)
      ) {
        return { form: { formId, ...form }, publicTokenKey: hashValue(token) };
      }
    }

    const publicTokenHash = hashValue(String(token || ""));
    const [form] = await queryDocs(
      COLLECTIONS.teamIntakeForms,
      [{ field: "publicTokenHash", value: publicTokenHash }],
      { limit: 1 },
    );
    if (!form || form.archivedAt) {
      throw httpError(404, "Form not found.");
    }
    return {
      form: { formId: form.id, ...form },
      publicTokenKey: publicTokenHash,
    };
  };

  // --- Public (view-only) schedule links -------------------------------------
  // Mirrors the intake public-link pattern: a short token stored alongside its
  // hash, looked up by hash for the unauthenticated read endpoint.

  const createTeamScheduleShortPublicToken = () =>
    crypto.randomBytes(9).toString("base64url");

  const ensureTeamSchedulePublicLinkToken = async (
    scheduleId,
    existing,
    adminUid,
  ) => {
    const storedToken = String(existing?.publicLinkToken || "").trim();
    if (storedToken) {
      return storedToken;
    }
    const publicLinkToken = createTeamScheduleShortPublicToken();
    await setDoc(
      COLLECTIONS.teamSchedules,
      scheduleId,
      {
        publicLinkToken,
        publicTokenHash: hashValue(publicLinkToken),
        updatedAt: nowIso(),
        updatedByUid: adminUid,
      },
      { merge: true },
    );
    return publicLinkToken;
  };

  const getTeamScheduleByToken = async (token) => {
    const trimmed = String(token || "").trim();
    if (!trimmed) {
      throw httpError(404, "Schedule not found.");
    }
    const publicTokenHash = hashValue(trimmed);
    const [schedule] = await queryDocs(
      COLLECTIONS.teamSchedules,
      [{ field: "publicTokenHash", value: publicTokenHash }],
      { limit: 1 },
    );
    if (!schedule || schedule.archivedAt) {
      throw httpError(404, "Schedule not found.");
    }
    return {
      schedule: { scheduleId: schedule.id, ...schedule },
      publicTokenKey: publicTokenHash,
    };
  };

  // First name, plus a last initial only when first names collide. Keeps full
  // last names and contact details from ever leaving the server on a public link.
  const scheduleMemberPublicName = (member, duplicateFirstNames) => {
    const firstName = String(member?.firstName || "").trim();
    const lastInitial = String(member?.lastName || "")
      .trim()
      .charAt(0);
    // Never let a full last name leave the server: fall back to an initial only.
    if (!firstName) {
      return lastInitial ? `${lastInitial}.` : "Member";
    }
    if (duplicateFirstNames.has(firstName.toLowerCase()) && lastInitial) {
      return `${firstName} ${lastInitial}.`;
    }
    return firstName;
  };

  const buildPublicTeamScheduleSnapshot = async (schedule) => {
    const churchId = schedule.churchId;
    const assignedMemberIds = new Set();
    Object.values(schedule.assignments || {}).forEach((row) => {
      Object.values(row || {}).forEach((cell) => {
        getScheduleAssignmentCellMemberIds(cell).forEach((memberId) =>
          assignedMemberIds.add(memberId),
        );
      });
    });
    const church = await getDoc(COLLECTIONS.churches, churchId);
    const team = schedule.teamId
      ? await getTeamEntity("team", schedule.teamId)
      : null;
    const [positions, members, churchLogoUrl] = await Promise.all([
      team && team.churchId === churchId
        ? queryDocs(
            COLLECTIONS.teamPositions,
            [
              { field: "churchId", value: churchId },
              { field: "teamId", value: schedule.teamId },
            ],
            { limit: TEAM_COLLECTION_QUERY_LIMIT },
          )
        : [],
      Promise.all(
        [...assignedMemberIds].map((memberId) =>
          getTeamEntity("member", memberId),
        ),
      ),
      readChurchPublicBoardHeaderLogoUrl(churchId),
    ]);

    const assignedMembers = members.filter(
      (member) => member && member.churchId === churchId,
    );
    const referencedPositions = positions.filter(
      (position) =>
        position &&
        position.churchId === churchId &&
        position.teamId === schedule.teamId,
    );

    const firstNameCounts = new Map();
    assignedMembers.forEach((member) => {
      const firstName = String(member.firstName || "")
        .trim()
        .toLowerCase();
      if (!firstName) return;
      firstNameCounts.set(firstName, (firstNameCounts.get(firstName) || 0) + 1);
    });
    const duplicateFirstNames = new Set(
      [...firstNameCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    );

    return {
      churchName: church?.name || "WorshipSync",
      teamName:
        team && team.churchId === churchId
          ? String(team.name || "").trim()
          : "",
      ...(churchLogoUrl ? { churchLogoUrl } : {}),
      schedule: {
        scheduleId: schedule.scheduleId,
        name: schedule.name || "",
        teamId: schedule.teamId || "",
        startDate: schedule.startDate || "",
        endDate: schedule.endDate || "",
        occurrences: schedule.occurrences || [],
        assignments: schedule.assignments || {},
      },
      positions: sortPositionsByOrder(
        referencedPositions,
      ).map((position) => ({
        positionId: position.positionId,
        name: position.name,
        groupId: position.groupId || "",
        archivedAt: position.archivedAt || null,
      })),
      members: assignedMembers.map((member) => ({
        memberId: member.memberId,
        name: scheduleMemberPublicName(member, duplicateFirstNames),
      })),
    };
  };

  const assertTeamIntakeFormIsOpen = (form) => {
    if (!form.active) {
      throw httpError(400, "This form is closed.");
    }
  };

  const getScheduleAssignmentCellMemberIds = (cell) => {
    const normalized = normalizeScheduleAssignmentCell(cell);
    return [
      normalized.primaryMemberId,
      ...normalized.shadows.map((shadow) => shadow.memberId),
    ].filter(Boolean);
  };

  // Schedule assignments are keyed by a "slot key" so one position can be filled
  // multiple times per service. Every slot is explicit: `${positionId}::${slot}`.
  // Mirrors the client helpers in
  // client/src/pages/Teams/schedule/scheduleRequirements.ts.
  const SCHEDULE_SLOT_KEY_SEPARATOR = "::";

  const makeScheduleSlotKey = (positionId, slot) =>
    `${positionId}${SCHEDULE_SLOT_KEY_SEPARATOR}${slot}`;

  const parseScheduleSlotKey = (value) => {
    const raw = String(value || "");
    const idx = raw.lastIndexOf(SCHEDULE_SLOT_KEY_SEPARATOR);
    if (idx === -1) return null;
    const base = raw.slice(0, idx);
    const slot = Number.parseInt(
      raw.slice(idx + SCHEDULE_SLOT_KEY_SEPARATOR.length),
      10,
    );
    if (!base || !Number.isInteger(slot) || slot < 0) {
      return null;
    }
    return { positionId: base, slot };
  };

  const buildValidatedScheduleAssignments = ({
    churchId,
    schedule,
    team,
    position,
    member,
    serviceId,
    positionSlotKey,
    memberId,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
  }) => {
    const rowIds = (schedule.occurrences || []).map(
      (occurrence) => occurrence.occurrenceId,
    );
    const allowedRowIds =
      rowIds.length > 0 ? rowIds : schedule.serviceIds || [];
    if (!allowedRowIds.includes(serviceId)) {
      throw httpError(400, "That service occurrence is not in this schedule.");
    }
    const targetSlot = parseScheduleSlotKey(positionSlotKey);
    if (!targetSlot) {
      throw httpError(400, "Position slot key is invalid.");
    }
    const basePositionId = targetSlot.positionId;
    const cellKey = makeScheduleSlotKey(basePositionId, targetSlot.slot);
    if (!position || position.churchId !== churchId || position.archivedAt) {
      throw httpError(400, "Position is archived.");
    }
    if (position.teamId !== team.teamId) {
      throw httpError(400, "That position is not part of this team.");
    }

    const assignments = JSON.parse(JSON.stringify(schedule.assignments || {}));
    const normalizedSourceServiceId = String(sourceServiceId || "").trim();
    const sourceSlot = parseScheduleSlotKey(sourcePositionSlotKey);
    const normalizedSourcePositionSlotKey =
      String(sourcePositionSlotKey || "").trim() && sourceSlot
        ? makeScheduleSlotKey(sourceSlot.positionId, sourceSlot.slot)
        : "";
    if (
      normalizedSourceServiceId &&
      normalizedSourcePositionSlotKey &&
      assignments[normalizedSourceServiceId]
    ) {
      const sourceCell = normalizeScheduleAssignmentCell(
        assignments[normalizedSourceServiceId][normalizedSourcePositionSlotKey],
      );
      const nextSourceCell = serializeScheduleAssignmentCell({
        primaryMemberId: "",
        shadows: sourceCell.shadows,
      });
      if (nextSourceCell) {
        assignments[normalizedSourceServiceId][
          normalizedSourcePositionSlotKey
        ] = nextSourceCell;
      } else {
        delete assignments[normalizedSourceServiceId][
          normalizedSourcePositionSlotKey
        ];
      }
      if (Object.keys(assignments[normalizedSourceServiceId]).length === 0) {
        delete assignments[normalizedSourceServiceId];
      }
    }

    const normalizedMemberId = String(memberId || "").trim();
    const normalizedShadowAction = String(shadowAction || "").trim();
    const normalizedShadowKind = String(shadowKind || "").trim();
    const isShadowUpdate =
      normalizedShadowAction === "add" || normalizedShadowAction === "remove";
    if (isShadowUpdate) {
      if (!normalizedMemberId) {
        throw httpError(400, "Member is required.");
      }
      if (!TEAM_SCHEDULE_SHADOW_KINDS.has(normalizedShadowKind)) {
        throw httpError(400, "Shadow type is required.");
      }

      const targetRow = { ...(assignments[serviceId] || {}) };
      const targetCell = normalizeScheduleAssignmentCell(targetRow[cellKey]);

      if (normalizedShadowAction === "add") {
        if (!member || member.churchId !== churchId || member.archivedAt) {
          throw httpError(400, "Member is archived.");
        }
        if (!(team.memberIds || []).includes(normalizedMemberId)) {
          throw httpError(400, "That member is not part of this team.");
        }
        if (
          normalizedShadowKind === "reverse_shadow" &&
          !(member.positionIds || []).includes(basePositionId)
        ) {
          throw httpError(400, "That member cannot serve in this position.");
        }
        if (
          isMemberUnavailableForService(member, { date: serviceDate || "" })
        ) {
          throw httpError(400, "That member is unavailable for this service.");
        }

        const serviceAssignments = assignments[serviceId] || {};
        const assignedElsewhere = Object.values(serviceAssignments).some(
          (cell) =>
            getScheduleAssignmentCellMemberIds(cell).includes(
              normalizedMemberId,
            ),
        );
        if (assignedElsewhere) {
          throw httpError(
            400,
            "Members can only serve one position per service.",
          );
        }
      }

      const nextShadows =
        normalizedShadowAction === "add"
          ? [
              ...targetCell.shadows.filter(
                (shadow) => shadow.memberId !== normalizedMemberId,
              ),
              { memberId: normalizedMemberId, kind: normalizedShadowKind },
            ]
          : targetCell.shadows.filter(
              (shadow) =>
                !(
                  shadow.memberId === normalizedMemberId &&
                  shadow.kind === normalizedShadowKind
                ),
            );
      const nextTargetCell = serializeScheduleAssignmentCell({
        primaryMemberId: targetCell.primaryMemberId,
        shadows: nextShadows,
      });
      if (nextTargetCell) {
        targetRow[cellKey] = nextTargetCell;
      } else {
        delete targetRow[cellKey];
      }
      if (Object.keys(targetRow).length > 0) {
        assignments[serviceId] = targetRow;
      } else {
        delete assignments[serviceId];
      }
      return assignments;
    }

    if (!normalizedMemberId) {
      if (assignments[serviceId]) {
        const targetCell = normalizeScheduleAssignmentCell(
          assignments[serviceId][cellKey],
        );
        const nextTargetCell = serializeScheduleAssignmentCell({
          primaryMemberId: "",
          shadows: targetCell.shadows,
        });
        if (nextTargetCell) {
          assignments[serviceId][cellKey] = nextTargetCell;
        } else {
          delete assignments[serviceId][cellKey];
        }
        if (Object.keys(assignments[serviceId]).length === 0) {
          delete assignments[serviceId];
        }
      }
      return assignments;
    }

    if (!member || member.churchId !== churchId || member.archivedAt) {
      throw httpError(400, "Member is archived.");
    }
    if (!(team.memberIds || []).includes(normalizedMemberId)) {
      throw httpError(400, "That member is not part of this team.");
    }
    if (!(member.positionIds || []).includes(basePositionId)) {
      throw httpError(400, "That member cannot serve in this position.");
    }
    if (isMemberUnavailableForService(member, { date: serviceDate || "" })) {
      throw httpError(400, "That member is unavailable for this service.");
    }

    const serviceAssignments = assignments[serviceId] || {};
    const assignedElsewhere = Object.entries(serviceAssignments).some(
      ([assignedPositionSlotKey, cell]) => {
        const normalizedCell = normalizeScheduleAssignmentCell(cell);
        if (assignedPositionSlotKey === cellKey) {
          return normalizedCell.shadows.some(
            (shadow) => shadow.memberId === normalizedMemberId,
          );
        }
        return getScheduleAssignmentCellMemberIds(cell).includes(
          normalizedMemberId,
        );
      },
    );
    if (assignedElsewhere) {
      throw httpError(400, "Members can only serve one position per service.");
    }

    const targetCell = normalizeScheduleAssignmentCell(
      serviceAssignments[cellKey],
    );
    const nextTargetCell = serializeScheduleAssignmentCell({
      primaryMemberId: normalizedMemberId,
      shadows: targetCell.shadows,
    });
    assignments[serviceId] = {
      ...serviceAssignments,
      [cellKey]: nextTargetCell,
    };
    return assignments;
  };

  const validateScheduleAssignment = async ({
    churchId,
    scheduleId,
    serviceId,
    positionSlotKey,
    memberId,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
  }) => {
    const schedule = await assertTeamEntityInChurch(
      "schedule",
      scheduleId,
      churchId,
      { label: "Schedule" },
    );
    const team = await assertTeamEntityInChurch(
      "team",
      schedule.teamId,
      churchId,
      {
        label: "Team",
      },
    );
    const slot = parseScheduleSlotKey(positionSlotKey);
    if (!slot) {
      throw httpError(400, "Position slot key is invalid.");
    }
    const position = await assertTeamEntityInChurch(
      "position",
      slot.positionId,
      churchId,
      { label: "Position" },
    );
    const normalizedMemberId = String(memberId || "").trim();
    const member =
      normalizedMemberId && shadowAction !== "remove"
        ? await assertTeamEntityInChurch(
            "member",
            normalizedMemberId,
            churchId,
            {
              label: "Member",
            },
          )
        : null;
    return buildValidatedScheduleAssignments({
      churchId,
      schedule,
      team,
      position,
      member,
      serviceId,
      positionSlotKey,
      memberId,
      serviceDate,
      sourceServiceId,
      sourcePositionSlotKey,
      shadowAction,
      shadowKind,
    });
  };

  const readTransactionTeamEntity = (
    snapshot,
    idField,
    label,
    { active = true } = {},
  ) => {
    if (!snapshot.exists) {
      throw httpError(404, `${label} not found.`);
    }
    const entity = { [idField]: snapshot.id, ...snapshot.data() };
    if (active && entity.archivedAt) {
      throw httpError(400, `${label} is archived.`);
    }
    return entity;
  };

  const updateTeamScheduleAssignmentInStore = async ({
    churchId,
    scheduleId,
    serviceId,
    positionSlotKey,
    memberId,
    serviceDate,
    sourceServiceId,
    sourcePositionSlotKey,
    shadowAction,
    shadowKind,
    adminUserId,
  }) => {
    const db = requireFirestore();
    if (!db) {
      const assignments = await validateScheduleAssignment({
        churchId,
        scheduleId,
        serviceId,
        positionSlotKey,
        memberId,
        serviceDate,
        sourceServiceId,
        sourcePositionSlotKey,
        shadowAction,
        shadowKind,
      });
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        {
          assignments,
          updatedAt: nowIso(),
          updatedByUid: adminUserId,
        },
        { merge: true },
      );
      return getTeamEntity("schedule", scheduleId);
    }

    return db.runTransaction(async (transaction) => {
      const scheduleRef = db
        .collection(COLLECTIONS.teamSchedules)
        .doc(scheduleId);
      const scheduleSnap = await transaction.get(scheduleRef);
      const schedule = readTransactionTeamEntity(
        scheduleSnap,
        "scheduleId",
        "Schedule",
      );
      if (schedule.churchId !== churchId) {
        throw httpError(404, "Schedule not found.");
      }

      const teamSnap = await transaction.get(
        db.collection(COLLECTIONS.teams).doc(schedule.teamId),
      );
      const team = readTransactionTeamEntity(teamSnap, "teamId", "Team");
      if (team.churchId !== churchId) {
        throw httpError(404, "Team not found.");
      }

      const targetSlot = parseScheduleSlotKey(positionSlotKey);
      if (!targetSlot) {
        throw httpError(400, "Position slot key is invalid.");
      }
      const positionSnap = await transaction.get(
        db.collection(COLLECTIONS.teamPositions).doc(targetSlot.positionId),
      );
      const position = readTransactionTeamEntity(
        positionSnap,
        "positionId",
        "Position",
      );
      if (position.churchId !== churchId) {
        throw httpError(404, "Position not found.");
      }

      const normalizedMemberId = String(memberId || "").trim();
      let member = null;
      if (normalizedMemberId && shadowAction !== "remove") {
        const memberSnap = await transaction.get(
          db.collection(COLLECTIONS.teamRosterMembers).doc(normalizedMemberId),
        );
        member = readTransactionTeamEntity(memberSnap, "memberId", "Member");
        if (member.churchId !== churchId) {
          throw httpError(404, "Member not found.");
        }
      }

      const assignments = buildValidatedScheduleAssignments({
        churchId,
        schedule,
        team,
        position,
        member,
        serviceId,
        positionSlotKey,
        memberId,
        serviceDate,
        sourceServiceId,
        sourcePositionSlotKey,
        shadowAction,
        shadowKind,
      });
      const update = {
        assignments,
        updatedAt: nowIso(),
        updatedByUid: adminUserId,
      };
      // Use update (not set with merge) so the assignments map is replaced
      // wholesale. A merged set deep-merges nested maps, which would keep
      // cleared/moved cell keys we deleted and resurrect old assignments.
      transaction.update(scheduleRef, update);
      return { ...schedule, ...update };
    });
  };

  const updateTeamScheduleAttendanceInStore = async ({
    churchId,
    scheduleId,
    occurrenceId,
    memberId,
    status,
    columnKey,
    positionId,
    positionLabel,
    adminUserId,
  }) => {
    const db = requireFirestore();
    if (!db) {
      const schedule = await assertTeamEntityInChurch(
        "schedule",
        scheduleId,
        churchId,
        { label: "Schedule", active: false },
      );
      const team = await assertTeamEntityInChurch(
        "team",
        schedule.teamId,
        churchId,
        { label: "Team", active: false },
      );
      const attendance = buildNextScheduleAttendance({
        schedule,
        team,
        occurrenceId,
        memberId,
        status,
        columnKey,
        positionId,
        positionLabel,
      });
      await setDoc(
        COLLECTIONS.teamSchedules,
        scheduleId,
        { attendance, updatedAt: nowIso(), updatedByUid: adminUserId },
        { merge: true },
      );
      return getTeamEntity("schedule", scheduleId);
    }

    return db.runTransaction(async (transaction) => {
      const scheduleRef = db
        .collection(COLLECTIONS.teamSchedules)
        .doc(scheduleId);
      const scheduleSnap = await transaction.get(scheduleRef);
      const schedule = readTransactionTeamEntity(
        scheduleSnap,
        "scheduleId",
        "Schedule",
      );
      if (schedule.churchId !== churchId) {
        throw httpError(404, "Schedule not found.");
      }
      const teamSnap = await transaction.get(
        db.collection(COLLECTIONS.teams).doc(schedule.teamId),
      );
      const team = readTransactionTeamEntity(teamSnap, "teamId", "Team");
      if (team.churchId !== churchId) {
        throw httpError(404, "Team not found.");
      }
      const attendance = buildNextScheduleAttendance({
        schedule,
        team,
        occurrenceId,
        memberId,
        status,
        columnKey,
        positionId,
        positionLabel,
      });
      const update = {
        attendance,
        updatedAt: nowIso(),
        updatedByUid: adminUserId,
      };
      // Use update (not set with merge) so the attendance map is replaced
      // wholesale; a merged set would resurrect cleared attendance marks.
      transaction.update(scheduleRef, update);
      return { ...schedule, ...update };
    });
  };

  return {
    async getTeamsBootstrap(req, res) {
      try {
        await requireTeamsView(req, req.params.churchId);
        return res.json({
          success: true,
          ...(await buildTeamsBootstrap(req.params.churchId)),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load teams.");
      }
    },

    async createTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const payload = await validateTeamMemberPayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForMember(
          req,
          req.params.churchId,
          payload,
        );
        const member = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: member.memberId,
        });
        return res.json({ success: true, member });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this member.");
      }
    },

    async updateTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "member",
          req.params.memberId,
          req.params.churchId,
          { label: "Member", active: false },
        );
        const payload = await validateTeamMemberPayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [
            ...(await collectMemberTeamIds(existing, req.params.churchId)),
            ...(await collectMemberTeamIds(payload, req.params.churchId)),
          ],
        );
        const member = await upsertTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: member.memberId,
        });
        return res.json({ success: true, member });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this member.");
      }
    },

    async archiveTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "member",
          req.params.memberId,
          req.params.churchId,
          { label: "Member", active: false },
        );
        const admin = await requireTeamsEditForMember(
          req,
          req.params.churchId,
          existing,
        );
        await archiveTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: req.params.memberId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this member.");
      }
    },

    async createTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const payload = await validateTeamPositionPayload(
          req.body,
          req.params.churchId,
        );
        const position = await upsertTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          payload: {
            ...payload,
            order: await nextPositionOrder(req.params.churchId, payload.teamId),
          },
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: position.positionId,
        });
        return res.json({ success: true, position });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this position.");
      }
    },

    async createTeamIntakeForm(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const formId = createId("teamIntakeForm");
        const publicLinkToken = createTeamIntakeShortPublicToken();
        const payload = validateTeamIntakeFormPayload(req.body);
        const now = nowIso();
        const form = {
          ...payload,
          formId,
          churchId: req.params.churchId,
          publicLinkToken,
          publicTokenHash: hashValue(publicLinkToken),
          archivedAt: null,
          createdAt: now,
          createdByUid: admin.user.uid,
          updatedAt: now,
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.teamIntakeForms, formId, form, {
          merge: false,
        });
        await addSecurityEvent({
          type: "team_intake_form_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId,
        });
        return res.json({
          success: true,
          form: sanitizeTeamIntakeFormForAdmin(form, 0),
          publicToken: publicLinkToken,
          publicUrl: buildTeamIntakePublicUrl(publicLinkToken),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this intake form.");
      }
    },

    async updateTeamIntakeForm(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const existing = await getDoc(
          COLLECTIONS.teamIntakeForms,
          req.params.formId,
        );
        if (!existing || existing.churchId !== req.params.churchId) {
          throw httpError(404, "Intake form not found.");
        }
        const payload = validateTeamIntakeFormPayload(req.body, existing);
        const update = {
          ...payload,
          updatedAt: nowIso(),
          updatedByUid: admin.user.uid,
        };
        await setDoc(COLLECTIONS.teamIntakeForms, req.params.formId, update, {
          merge: true,
        });
        const nextForm = {
          formId: req.params.formId,
          ...existing,
          ...update,
        };
        await addSecurityEvent({
          type: "team_intake_form_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId: req.params.formId,
        });
        return res.json({
          success: true,
          form: sanitizeTeamIntakeFormForAdmin(nextForm),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this intake form.");
      }
    },

    async getTeamIntakeFormLink(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const existing = await getDoc(
          COLLECTIONS.teamIntakeForms,
          req.params.formId,
        );
        if (!existing || existing.churchId !== req.params.churchId) {
          throw httpError(404, "Intake form not found.");
        }
        const publicLinkToken = await ensureTeamIntakePublicLinkToken(
          req.params.formId,
          existing,
          admin.user.uid,
        );
        const nextForm = {
          formId: req.params.formId,
          ...existing,
          publicLinkToken,
          publicTokenHash: hashValue(publicLinkToken),
          updatedAt: nowIso(),
          updatedByUid: admin.user.uid,
        };
        await addSecurityEvent({
          type: "team_intake_form_link_copied",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          formId: req.params.formId,
        });
        return res.json({
          success: true,
          form: sanitizeTeamIntakeFormForAdmin(nextForm),
          publicToken: publicLinkToken,
          publicUrl: buildTeamIntakePublicUrl(publicLinkToken),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not create a new intake link.");
      }
    },

    async getTeamIntakePreview(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "team-intake-preview",
          token: req.query?.token,
          limit: 30,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const { form } = await getTeamIntakeFormByToken(req.query?.token);
        assertTeamIntakeFormIsOpen(form);
        const church = await getDoc(COLLECTIONS.churches, form.churchId);
        const churchLogoUrl = await readChurchPublicBoardHeaderLogoUrl(
          form.churchId,
        );
        const [allPositions, allTeams] = await Promise.all([
          listTeamCollectionForChurch(
            COLLECTIONS.teamPositions,
            "positionId",
            form.churchId,
          ),
          listTeamCollectionForChurch(
            COLLECTIONS.teams,
            "teamId",
            form.churchId,
          ),
        ]);
        // An empty teamIds scopes the form to every team in the church.
        const scopedTeamIds = new Set(form.teamIds || []);
        const positions = sortPositionsByOrder(
          allPositions.filter(
            (position) =>
              !position.archivedAt &&
              (scopedTeamIds.size === 0 || scopedTeamIds.has(position.teamId)),
          ),
        );
        // Only the teams the shown positions belong to, so the public form can
        // group positions under a team header.
        const referencedTeamIds = new Set(
          positions.map((position) => position.teamId),
        );
        const teams = allTeams
          .filter((team) => referencedTeamIds.has(team.teamId))
          .map((team) => ({ teamId: team.teamId, name: team.name || "Team" }));
        return res.json({
          success: true,
          churchName: church?.name || "WorshipSync",
          ...(churchLogoUrl ? { churchLogoUrl } : {}),
          form: {
            formId: form.formId,
            name: form.name,
            startDate: form.startDate,
            endDate: form.endDate,
            availabilityServices: form.availabilityServices || [],
            availabilityOccurrences: form.availabilityOccurrences || [],
          },
          // Allowlist the fields the public form needs — never ship internal
          // position columns (description, order, timestamps) on a public link.
          positions: positions.map((position) => ({
            positionId: position.positionId,
            teamId: position.teamId,
            name: position.name,
            icon: position.icon || "",
          })),
          teams,
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load this intake form.");
      }
    },

    async submitTeamIntake(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "team-intake-submit",
          token: req.query?.token,
          limit: 10,
          windowMs: 10 * 60 * 1000,
          blockMs: 30 * 60 * 1000,
        });
        const { form } = await getTeamIntakeFormByToken(req.query?.token);
        assertTeamIntakeFormIsOpen(form);
        const payload = await validateTeamIntakeSubmissionPayload(
          req.body,
          form,
        );
        const submissionId = createId("teamIntakeSubmission");
        await setDoc(
          COLLECTIONS.teamIntakeSubmissions,
          submissionId,
          {
            ...payload,
            submissionId,
            formId: form.formId,
            churchId: form.churchId,
            status: "new",
            submittedAt: nowIso(),
          },
          { merge: false },
        );
        return res.json({ success: true, submissionId });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not submit this form.");
      }
    },

    async updateTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const position = await upsertTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          id: req.params.positionId,
          payload: await validateTeamPositionPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: position.positionId,
        });
        return res.json({ success: true, position });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this position.");
      }
    },

    async reorderTeamPositions(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const churchId = req.params.churchId;
        // The team scopes the reorder so we never renumber another team's positions.
        const team = await assertTeamEntityInChurch(
          "team",
          req.body?.teamId,
          churchId,
          { label: "Team", active: false },
        );
        const positionIds = normalizeIdArray(req.body?.positionIds);
        if (!positionIds.length) {
          throw httpError(400, "No positions to reorder.");
        }
        // Every id must be an existing position in this church owned by the team
        // (archived included — order applies to the whole list).
        const positions = await Promise.all(
          positionIds.map(async (positionId) => {
            const position = await assertTeamEntityInChurch(
              "position",
              positionId,
              churchId,
              { label: "Position", active: false },
            );
            if (position.teamId !== team.teamId) {
              throw httpError(400, "That position is not part of this team.");
            }
            return position;
          }),
        );
        const now = nowIso();
        await Promise.all(
          positionIds.map((positionId, index) =>
            setDoc(
              COLLECTIONS.teamPositions,
              positionId,
              {
                order: index,
                updatedAt: now,
                updatedByUid: admin.user.uid,
              },
              { merge: true },
            ),
          ),
        );
        await addSecurityEvent({
          type: "team_positions_reordered",
          churchId,
          userId: admin.user.uid,
          teamId: team.teamId,
        });
        const reordered = positions.map((position, index) => ({
          ...position,
          order: index,
        }));
        return res.json({ success: true, positions: reordered });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not reorder positions.");
      }
    },

    async archiveTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          id: req.params.positionId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: req.params.positionId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this position.");
      }
    },

    async createTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const role = await upsertTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          payload: await validateTeamRolePayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: role.roleId,
        });
        return res.json({ success: true, role });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this role.");
      }
    },

    async updateTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const role = await upsertTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          id: req.params.roleId,
          payload: await validateTeamRolePayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: role.roleId,
        });
        return res.json({ success: true, role });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this role.");
      }
    },

    async archiveTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          id: req.params.roleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: req.params.roleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this role.");
      }
    },

    async deleteTeamRole(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "role",
          churchId: req.params.churchId,
          id: req.params.roleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_role_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          roleId: req.params.roleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this role.");
      }
    },

    async createTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const area = await upsertTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          payload: await validateQualificationAreaPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: area.areaId,
        });
        return res.json({ success: true, area });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this qualification area.");
      }
    },

    async updateTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const area = await upsertTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          id: req.params.areaId,
          payload: await validateQualificationAreaPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: area.areaId,
        });
        return res.json({ success: true, area });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this qualification area.");
      }
    },

    async archiveTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          id: req.params.areaId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: req.params.areaId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this qualification area.");
      }
    },

    async deleteTeamQualificationArea(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "qualificationArea",
          churchId: req.params.churchId,
          id: req.params.areaId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_area_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          areaId: req.params.areaId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this qualification area.");
      }
    },

    async createTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const level = await upsertTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          payload: await validateQualificationLevelPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: level.levelId,
        });
        return res.json({ success: true, level });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this qualification level.");
      }
    },

    async updateTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const level = await upsertTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          id: req.params.levelId,
          payload: await validateQualificationLevelPayload(
            req.body,
            req.params.churchId,
          ),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: level.levelId,
        });
        return res.json({ success: true, level });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this qualification level.");
      }
    },

    async archiveTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          id: req.params.levelId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: req.params.levelId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this qualification level.");
      }
    },

    async deleteTeamQualificationLevel(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "qualificationLevel",
          churchId: req.params.churchId,
          id: req.params.levelId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_qualification_level_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          levelId: req.params.levelId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this qualification level.");
      }
    },

    async createTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const team = await upsertTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          payload: await validateTeamPayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: team.teamId,
        });
        return res.json({ success: true, team });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this team.");
      }
    },

    async updateTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const team = await upsertTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          payload: await validateTeamPayload(req.body, req.params.churchId),
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: team.teamId,
        });
        return res.json({ success: true, team });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this team.");
      }
    },

    async archiveTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await archiveTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: req.params.teamId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this team.");
      }
    },

    async createTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const payload = await validateTeamSchedulePayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          payload.teamId,
        );
        const schedule = await upsertTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_created",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: schedule.scheduleId,
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this schedule.");
      }
    },

    async getTeamSchedulePublicLink(req, res) {
      try {
        await assertCsrf(req);
        const existing = await getDoc(
          COLLECTIONS.teamSchedules,
          req.params.scheduleId,
        );
        if (!existing || existing.churchId !== req.params.churchId) {
          throw httpError(404, "Schedule not found.");
        }
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const publicLinkToken = await ensureTeamSchedulePublicLinkToken(
          req.params.scheduleId,
          existing,
          admin.user.uid,
        );
        await addSecurityEvent({
          type: "team_schedule_link_copied",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        return res.json({ success: true, publicToken: publicLinkToken });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not create a public link.");
      }
    },

    async getPublicTeamSchedule(req, res) {
      try {
        enforcePublicTokenRateLimit({
          req,
          scope: "team-schedule-public",
          token: req.query?.token,
          limit: 60,
          windowMs: 10 * 60 * 1000,
          blockMs: 10 * 60 * 1000,
        });
        const { schedule } = await getTeamScheduleByToken(req.query?.token);
        const snapshot = await buildPublicTeamScheduleSnapshot(schedule);
        return res.json({ success: true, ...snapshot });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not load this schedule.");
      }
    },

    async updateTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const payload = await validateTeamSchedulePayload(
          req.body,
          req.params.churchId,
        );
        const admin = await requireTeamsEditForTeamIds(
          req,
          req.params.churchId,
          [existing.teamId, payload.teamId],
        );
        const schedule = await upsertTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: schedule.scheduleId,
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not save this schedule.");
      }
    },

    async archiveTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        await archiveTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_archived",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not archive this schedule.");
      }
    },

    async deleteTeamRosterMember(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "member",
          req.params.memberId,
          req.params.churchId,
          { label: "Member", active: false },
        );
        const admin = await requireTeamsEditForMember(
          req,
          req.params.churchId,
          existing,
        );
        await deleteTeamEntity({
          kind: "member",
          churchId: req.params.churchId,
          id: req.params.memberId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_roster_member_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          memberId: req.params.memberId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this member.");
      }
    },

    async deleteTeamPosition(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "position",
          churchId: req.params.churchId,
          id: req.params.positionId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_position_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          positionId: req.params.positionId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this position.");
      }
    },

    async deleteTeam(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        await deleteTeamEntity({
          kind: "team",
          churchId: req.params.churchId,
          id: req.params.teamId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          teamId: req.params.teamId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this team.");
      }
    },

    async deleteTeamSchedule(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        await deleteTeamEntity({
          kind: "schedule",
          churchId: req.params.churchId,
          id: req.params.scheduleId,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_deleted",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
        });
        return res.json({ success: true });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not delete this schedule.");
      }
    },

    async updateTeamIntakeSubmission(req, res) {
      try {
        await assertCsrf(req);
        const admin = await requireTeamsEdit(req, req.params.churchId);
        const submission = await getDoc(
          COLLECTIONS.teamIntakeSubmissions,
          req.params.submissionId,
        );
        if (!submission || submission.churchId !== req.params.churchId) {
          throw httpError(404, "Submission not found.");
        }
        const action = String(req.body?.action || "").trim();
        const now = nowIso();
        let member = null;
        const update = {
          status: action,
          reviewedAt: now,
          reviewedByUid: admin.user.uid,
          updatedAt: now,
          updatedByUid: admin.user.uid,
        };

        if (action === "applied") {
          const blockoutDates = (submission.blockoutRanges || []).map(
            (range) => ({
              startDate: range.startDate,
              endDate: range.endDate,
              notes: "From intake form",
            }),
          );
          if (req.body?.createMember) {
            member = await upsertTeamEntity({
              kind: "member",
              churchId: req.params.churchId,
              payload: {
                firstName: submission.firstName,
                lastName: submission.lastName,
                dateOfBirth: "",
                positionIds: submission.positionIds || [],
                blockoutDates,
                notes: normalizeLongText(submission.notes),
              },
              adminUserId: admin.user.uid,
            });
            await addMemberToTeamsForPositions({
              churchId: req.params.churchId,
              positionIds: submission.positionIds || [],
              memberId: member.memberId,
              adminUserId: admin.user.uid,
            });
          } else {
            const memberId = normalizeShortText(req.body?.memberId, {
              max: 160,
            });
            member = await assertTeamEntityInChurch(
              "member",
              memberId,
              req.params.churchId,
              { label: "Member", active: false },
            );
            const nextPositionIds = normalizeIdArray([
              ...(member.positionIds || []),
              ...(submission.positionIds || []),
            ]);
            const nextBlockoutDates = [
              ...(member.blockoutDates || []),
              ...blockoutDates,
            ];
            await setDoc(
              COLLECTIONS.teamRosterMembers,
              member.memberId,
              {
                positionIds: nextPositionIds,
                blockoutDates: nextBlockoutDates,
                updatedAt: now,
                updatedByUid: admin.user.uid,
              },
              { merge: true },
            );
            member = await getTeamEntity("member", member.memberId);
          }
          update.status = "applied";
          update.appliedAt = now;
          update.appliedByUid = admin.user.uid;
          update.appliedMemberId = member.memberId;
        } else if (action === "reviewed" || action === "dismissed") {
          update.status = action;
        } else {
          throw httpError(400, "Review action is required.");
        }

        await setDoc(
          COLLECTIONS.teamIntakeSubmissions,
          req.params.submissionId,
          update,
          { merge: true },
        );
        await addSecurityEvent({
          type: `team_intake_submission_${update.status}`,
          churchId: req.params.churchId,
          userId: admin.user.uid,
          submissionId: req.params.submissionId,
          memberId: member?.memberId || null,
        });
        return res.json({
          success: true,
          submission: {
            submissionId: req.params.submissionId,
            ...submission,
            ...update,
          },
          ...(member ? { member } : {}),
        });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not update this submission.");
      }
    },

    async updateTeamScheduleAssignment(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const schedule = await updateTeamScheduleAssignmentInStore({
          churchId: req.params.churchId,
          scheduleId: req.params.scheduleId,
          serviceId: String(req.body?.serviceId || "").trim(),
          positionSlotKey: String(req.body?.positionSlotKey || "").trim(),
          memberId: req.body?.memberId == null ? "" : String(req.body.memberId),
          serviceDate: normalizeOptionalPlainDate(
            req.body?.serviceDate,
            "Service date",
          ),
          sourceServiceId: req.body?.sourceServiceId,
          sourcePositionSlotKey: req.body?.sourcePositionSlotKey,
          shadowAction: req.body?.shadowAction,
          shadowKind: req.body?.shadowKind,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_assignment_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
          serviceId: String(req.body?.serviceId || "").trim(),
          positionSlotKey: String(req.body?.positionSlotKey || "").trim(),
          memberId: req.body?.memberId || null,
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not update this assignment.");
      }
    },

    async updateTeamScheduleAttendance(req, res) {
      try {
        await assertCsrf(req);
        const existing = await assertTeamEntityInChurch(
          "schedule",
          req.params.scheduleId,
          req.params.churchId,
          { label: "Schedule", active: false },
        );
        const admin = await requireTeamsEditForTeam(
          req,
          req.params.churchId,
          existing.teamId,
        );
        const payload = validateTeamScheduleAttendanceUpdatePayload(req.body);
        const schedule = await updateTeamScheduleAttendanceInStore({
          churchId: req.params.churchId,
          scheduleId: req.params.scheduleId,
          ...payload,
          adminUserId: admin.user.uid,
        });
        await addSecurityEvent({
          type: "team_schedule_attendance_updated",
          churchId: req.params.churchId,
          userId: admin.user.uid,
          scheduleId: req.params.scheduleId,
          occurrenceId: payload.occurrenceId,
          memberId: payload.memberId,
        });
        return res.json({ success: true, schedule });
      } catch (error) {
        return sendTeamsJsonError(res, error, "Could not update attendance.");
      }
    },
  };
};
