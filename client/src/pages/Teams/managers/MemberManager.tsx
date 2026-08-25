import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Plus, X } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import SearchableSelect from "../../../components/SearchableSelect";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import DatePicker from "@/components/ui/DatePicker";
import BirthDateField from "../components/BirthDateField";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import {
  archiveTeamRosterMember,
  createTeamRosterMember,
  deleteTeamRosterMember,
  inviteTeamRosterMember,
  linkTeamRosterMember,
  listChurchMembers,
  unlinkTeamRosterMember,
  updateTeamRosterMember,
  type TeamRosterMemberPayload,
} from "../../../api/auth";
import type {
  ChurchMemberRow,
  TeamMemberQualification,
  TeamMemberQualificationStatus,
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
} from "../../../api/authTypes";
import generateRandomId from "../../../utils/generateRandomId";
import CreatePanel from "../CreatePanel";
import {
  MemberFilterPanel,
  MemberListFilterToolbar,
  MEMBER_FILTER_PANEL_ID,
} from "../components/MemberListFilters";
import TeamsCrossSectionLink from "../components/TeamsCrossSectionLink";
import TeamsReturnToolbar from "../components/TeamsReturnToolbar";
import EntityMultiSelect from "../EntityMultiSelect";
import EntityRow from "../components/EntityRow";
import BlockoutDatesField from "../components/BlockoutDatesField";
import CollapsibleSectionTrigger from "../../../components/CollapsibleSectionTrigger/CollapsibleSectionTrigger";
import SelectAllButton from "../../../components/SelectAllButton";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { uploadImageToCloudinary } from "../../../containers/Media/utils/cloudinaryUpload";
import { deleteCloudinaryAsset } from "../../../utils/cloudinaryUtils";
import {
  countMemberAssignmentsOnTeam,
  describeDeletionImpacts,
  memberMatchesListQuery,
  memberName,
  orderPositionsByTeamList,
  sortTeamRosterMembersAlphabetically,
} from "../teamsUtils";
import { formatMemberSaveToast } from "../teamsSaveToasts";
import { canNotifyMember } from "../unnotifiableMembers";
import {
  TEAMS_MEMBER_EDIT_SEARCH_PARAM,
  TEAMS_SECTION_PATHS,
  buildSectionReturnTo,
  buildTeamsMemberEditPath,
  buildTeamsPositionEditPath,
} from "../teamsReturnNavigation";
import { useTeamsReturnNavigation } from "../hooks/useTeamsReturnNavigation";
import { useTeamsNarrowViewport } from "../hooks/useTeamsNarrowViewport";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import {
  countActiveMemberListFilters,
  emptyMemberListFilters,
  memberMatchesListFilters,
} from "../teamsSelectors";
import type { TeamsData } from "../types";
import {
  DEFAULT_SERVING_FREQUENCY,
  emptyRecurringAvailability,
  isMinorOnDate,
  recurringAvailabilityWeekOptions,
  servingFrequencyOptions,
} from "../memberPreferences";

const NO_SELECTION_VALUE = "__none";

// Filter-chip id for positions whose team no longer exists.
const NO_TEAM_GROUP_ID = "__no_team";

// Key used to track an in-flight save for the create form, which has no member
// id yet. Existing members are tracked by their own memberId.
const CREATE_SAVING_KEY = "__create__";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Membership lives on `team.memberIds`, so a member's teams have to be read off
 * the team list rather than the member. A `teamMemberships` entry counts too:
 * holding a role on a team is a form of belonging to it.
 *
 * Sorted so a draft built here compares cleanly against one the operator has
 * been toggling, whose selection order is arbitrary.
 */
const readMemberTeamIds = (member: TeamRosterMember, teams: TeamRecord[]) =>
  Array.from(
    new Set([
      ...teams
        .filter((team) => (team.memberIds || []).includes(member.memberId))
        .map((team) => team.teamId),
      ...Object.keys(member.teamMemberships || {}),
    ]),
  ).sort();

/**
 * The editor's draft for a member, or a blank one for the create form. Kept in
 * one place because the same shape is needed to seed the form, to reset it, and
 * to decide whether anything is unsaved.
 */
const buildMemberDraft = (
  member: TeamRosterMember | null,
  teamIds: string[],
): TeamRosterMemberPayload => ({
  title: member?.title || "",
  firstName: member?.firstName || "",
  lastName: member?.lastName || "",
  email: member?.email || "",
  birthDate: member?.birthDate || null,
  isMinor: Boolean(member?.isMinor),
  servingFrequency: member?.servingFrequency || DEFAULT_SERVING_FREQUENCY,
  recurringAvailability:
    member?.recurringAvailability || emptyRecurringAvailability(),
  positionIds: member?.positionIds || [],
  desiredPositionIds: member?.desiredPositionIds || [],
  teamIds,
  teamMemberships: member?.teamMemberships || {},
  qualifications: member?.qualifications || [],
  blockoutDates: member?.blockoutDates || [],
  notes: member?.notes || "",
  profileImageUrl: member?.profileImageUrl || "",
  profileImagePublicId: member?.profileImagePublicId || "",
});

const qualificationStatusOptions: {
  value: TeamMemberQualificationStatus;
  label: string;
}[] = [
    { value: "in_training", label: "In training" },
    { value: "completed", label: "Completed" },
    { value: "expired", label: "Expired" },
  ];

type MemberManagerProps = {
  members: TeamRosterMember[];
  positions: TeamPosition[];
  data: TeamsData;
  canEdit: boolean;
  onSaved: (member: TeamRosterMember, replaceId?: string) => void;
  /** Applies rosters the server changed by joining this member to a team. */
  onTeamSaved: (team: TeamRecord) => void;
  onArchived: () => void;
  onRemoved: (memberId: string) => void;
};

const MemberManager = ({
  members,
  positions,
  data,
  canEdit,
  onSaved,
  onTeamSaved,
  onArchived,
  onRemoved,
}: MemberManagerProps) => {
  const context = useContext(GlobalInfoContext);
  const { showToast, removeToast } = useToast();
  const churchId = context?.churchId || "";
  const currentUserId = context?.userId || "";
  /**
   * Inviting and listing church accounts both hit admin-only endpoints
   * (`createInvite`, `listChurchMembers` — both `requireAdminSession`). `canEdit`
   * includes Teams editors, so gating those controls on it alone would show a
   * non-admin an invite that 403s and a picker that is always empty.
   * Self-claim and unlink stay on `canEdit`: their endpoints take teams-edit.
   */
  const isChurchAdmin = context?.role === "admin";
  const [isUpdatingLink, setIsUpdatingLink] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [churchAccounts, setChurchAccounts] = useState<ChurchMemberRow[]>([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [editing, setEditing] = useState<TeamRosterMember | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<TeamRosterMember | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [draft, setDraft] = useState<TeamRosterMemberPayload>(() =>
    buildMemberDraft(null, []),
  );
  const [profileImageUploading, setProfileImageUploading] = useState(false);
  const [pendingProfileImage, setPendingProfileImage] = useState<File | null>(null);
  const [pendingProfileImagePreviewUrl, setPendingProfileImagePreviewUrl] =
    useState("");
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const profileImageSelectionToastIdRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (pendingProfileImagePreviewUrl) {
        URL.revokeObjectURL(pendingProfileImagePreviewUrl);
      }
    };
  }, [pendingProfileImagePreviewUrl]);
  const derivedMinorStatus = isMinorOnDate(draft.birthDate);
  // Members with a save currently in flight, keyed by memberId (or
  // CREATE_SAVING_KEY for a new member). Tracking per-editor keeps the Save
  // spinner on the member actually saving and lets editing continue back-to-back
  // in the background.
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [listQuery, setListQuery] = useState("");
  const [listFilters, setListFilters] = useState(emptyMemberListFilters);
  const [draftListFilters, setDraftListFilters] = useState(emptyMemberListFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [showDesiredPositions, setShowDesiredPositions] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { returnTo, finishEditing } = useTeamsReturnNavigation();
  const { requestDiscardAction } = useTeamsNavigationGuard();
  const isNarrowViewport = useTeamsNarrowViewport();
  const pendingEditMemberIdRef = useRef<string | null>(null);

  const openMemberEditor = useCallback(
    (member: TeamRosterMember) => {
      setShowFilters(false);
      setShowDesiredPositions(false);
      setPendingProfileImage(null);
      setPendingProfileImagePreviewUrl("");
      setEditing(member);
      setShowCreate(true);
      setDraft(buildMemberDraft(member, readMemberTeamIds(member, data.teams)));
    },
    [data.teams],
  );

  const selectMember = useCallback((member: TeamRosterMember) => {
    if (editing?.memberId === member.memberId) return;
    requestDiscardAction(() => openMemberEditor(member));
  }, [editing?.memberId, openMemberEditor, requestDiscardAction]);

  useEffect(() => {
    const editMemberId = searchParams.get(TEAMS_MEMBER_EDIT_SEARCH_PARAM)?.trim();
    if (!editMemberId || !canEdit) return;
    pendingEditMemberIdRef.current = editMemberId;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(TEAMS_MEMBER_EDIT_SEARCH_PARAM);
    setSearchParams(nextParams, { replace: true, state: location.state });
  }, [canEdit, location.state, searchParams, setSearchParams]);

  useEffect(() => {
    const editMemberId = pendingEditMemberIdRef.current;
    if (!editMemberId) return;
    const member = members.find((item) => item.memberId === editMemberId);
    if (!member) return;
    pendingEditMemberIdRef.current = null;
    openMemberEditor(member);
  }, [members, openMemberEditor]);

  useEffect(() => {
    if (!showCreate) return;
    setShowFilters(false);
  }, [showCreate]);

  const cancelFilters = useCallback(() => {
    setDraftListFilters(listFilters);
    setShowFilters(false);
  }, [listFilters]);

  const applyFilters = useCallback(() => {
    setListFilters(draftListFilters);
    setShowFilters(false);
  }, [draftListFilters]);

  const clearFilters = useCallback(() => {
    const empty = emptyMemberListFilters();
    setListFilters(empty);
    setDraftListFilters(empty);
    setShowFilters(false);
  }, []);

  const handleFiltersOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setDraftListFilters(listFilters);
        setShowFilters(true);
        return;
      }
      cancelFilters();
    },
    [cancelFilters, listFilters],
  );

  useEffect(() => {
    if (!showFilters) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelFilters();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelFilters, showFilters]);

  const positionNameById = useMemo(
    () => new Map(positions.map((position) => [position.positionId, position.name])),
    [positions],
  );
  const positionTeamIdById = useMemo(
    () =>
      new Map(positions.map((position) => [position.positionId, position.teamId])),
    [positions],
  );
  const teamNameById = useMemo(
    () => new Map(data.teams.map((team) => [team.teamId, team.name])),
    [data.teams],
  );
  const teamsById = useMemo(
    () => new Map(data.teams.map((team) => [team.teamId, team])),
    [data.teams],
  );
  const activeFilterCount = countActiveMemberListFilters(listFilters);
  const roleById = useMemo(
    () => new Map(data.teamRoles.map((role) => [role.roleId, role])),
    [data.teamRoles],
  );
  const areaById = useMemo(
    () => new Map(data.qualificationAreas.map((area) => [area.areaId, area])),
    [data.qualificationAreas],
  );
  // Teams the member belongs to right now, i.e. before anything in this draft.
  const joinedTeamIds = useMemo(
    () => (editing ? readMemberTeamIds(editing, data.teams) : []),
    [data.teams, editing],
  );

  const membersInListScope = useMemo(
    () =>
      listFilters.includeArchived
        ? members
        : members.filter((member) => !member.archivedAt),
    [listFilters.includeArchived, members],
  );

  const filteredMembers = useMemo(
    () =>
      sortTeamRosterMembersAlphabetically(
        members.filter((member) => {
          const positionNames = (member.positionIds || [])
            .map((positionId) => positionNameById.get(positionId))
            .filter(Boolean) as string[];
          if (!memberMatchesListQuery(member, listQuery, positionNames)) {
            return false;
          }
          return memberMatchesListFilters(member, listFilters, teamsById);
        }),
      ),
    [members, listQuery, listFilters, positionNameById, teamsById],
  );
  const hasPendingFilterChanges =
    JSON.stringify(draftListFilters) !== JSON.stringify(listFilters);

  const reset = () => {
    if (profileImageSelectionToastIdRef.current) {
      removeToast(profileImageSelectionToastIdRef.current);
      profileImageSelectionToastIdRef.current = null;
    }
    setEditing(null);
    setShowCreate(false);
    setDraft(buildMemberDraft(null, []));
    setShowDesiredPositions(false);
    setProfileImageUploading(false);
    setPendingProfileImage(null);
    setPendingProfileImagePreviewUrl("");
  };

  const uploadProfileImage = async (file: File) => {
    if (!canEdit || !file.type.startsWith("image/")) {
      showToast("Choose an image file.", "error");
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      showToast("Profile images must be 5 MB or smaller.", "error");
      return;
    }
    setPendingProfileImage(file);
    setPendingProfileImagePreviewUrl(URL.createObjectURL(file));
    if (profileImageSelectionToastIdRef.current) {
      removeToast(profileImageSelectionToastIdRef.current);
    }
    profileImageSelectionToastIdRef.current = showToast(
      "Profile image selected. Save the member to upload it.",
      "success",
    );
  };

  const cancelEditing = () => {
    finishEditing(reset);
  };

  const confirmDelete = async () => {
    if (!canEdit) return;
    if (!deleting) return;
    const member = deleting;
    if (member.memberId.startsWith("local-")) {
      onRemoved(member.memberId);
      setDeleting(null);
      return;
    }
    setDeleteBusy(true);
    onRemoved(member.memberId);
    try {
      await deleteTeamRosterMember(churchId, member.memberId);
      setDeleting(null);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this member.");
      onSaved(member);
    } finally {
      setDeleteBusy(false);
    }
  };

  // Fetched only when the operator asks for the picker. Linking someone else is
  // rare next to claiming your own record, so loading the church's accounts on
  // every member open would be a request paid for on the common path and used
  // on the uncommon one.
  useEffect(() => {
    // Also loaded for an already-linked member, so the panel can name the
    // address notifications will actually go to. Linked members are the
    // minority, so this stays off the common path.
    if (!isChurchAdmin) return;
    if (!churchId || (!showAccountPicker && !editing?.userId)) return;
    let cancelled = false;
    void listChurchMembers(churchId)
      .then((result) => {
        if (!cancelled) setChurchAccounts(result.members || []);
      })
      .catch(() => {
        // Non-fatal: "This is me" still works without the picker.
      });
    return () => {
      cancelled = true;
    };
  }, [churchId, showAccountPicker, editing?.userId, isChurchAdmin]);

  // Close the picker when moving between members so it never carries one
  // member's selection UI onto another.
  useEffect(() => {
    setShowAccountPicker(false);
  }, [editing?.memberId]);

  const linkedUserIds = useMemo(
    () =>
      new Set(
        members
          .map((member) => member.userId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    [members],
  );

  /**
   * The member record this account has already claimed, if any.
   *
   * An account may hold at most one member per church, so once this is set
   * "This is me" would fail on every other member. Hiding it there keeps a
   * self-claim offer from appearing on all sixty people in a roster the
   * operator is only managing on someone else's behalf.
   */
  const selfLinkedMember = useMemo(
    () =>
      currentUserId
        ? members.find((member) => member.userId === currentUserId)
        : undefined,
    [members, currentUserId],
  );

  /**
   * The address a linked member is actually reachable at.
   *
   * Read from the account rather than copied onto the member: an account email
   * can change, and a copy would silently go stale while still looking
   * authoritative. The member's own email stays the fallback for people who
   * have no account.
   */
  const linkedAccountEmail = useMemo(() => {
    if (!editing?.userId) return "";
    const row = churchAccounts.find((item) => item.userId === editing.userId);
    return row?.user?.email || "";
  }, [churchAccounts, editing?.userId]);

  /**
   * Mirrors the server's check so a typo is caught before a save round-trip
   * rather than coming back as a toast. Deliberately permissive for the same
   * reason the server is: over-strict patterns reject valid real addresses, and
   * a wrong address costs a bounced notification, not a broken roster.
   */
  const emailError = useMemo(() => {
    const value = (draft.email || "").trim();
    if (!value) return "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? ""
      : "Enter a valid email address.";
  }, [draft.email]);

  /**
   * An invite can only go to the address already stored on the member, since
   * that is what the server reads. A typed-but-unsaved change would otherwise
   * mail the previous address while the form showed the new one.
   */
  const canInviteMember = useMemo(() => {
    const saved = (editing?.email || "").trim().toLowerCase();
    if (!saved) return false;
    return (draft.email || "").trim().toLowerCase() === saved;
  }, [editing?.email, draft.email]);

  const linkableAccounts = useMemo(
    () =>
      churchAccounts
        .filter(
          (row) =>
            row.status === "active" &&
            row.userId &&
            row.userId !== currentUserId &&
            !linkedUserIds.has(row.userId),
        )
        .map((row) => ({
          label:
            row.user?.displayName || row.user?.email || row.userId,
          value: row.userId,
        })),
    [churchAccounts, currentUserId, linkedUserIds],
  );

  /**
   * Emails a member an invite bound to their record, so accepting it both
   * creates their account and links it here — no address matching involved.
   */
  const inviteMemberToAccount = async (member: TeamRosterMember) => {
    if (!canEdit || isInviting || !member.email) return;
    setIsInviting(true);
    try {
      await inviteTeamRosterMember(churchId, {
        email: member.email,
        memberId: member.memberId,
      });
      const next: TeamRosterMember = {
        ...member,
        invitedAt: new Date().toISOString(),
      };
      onSaved(next);
      setEditing((current) =>
        current?.memberId === member.memberId ? next : current,
      );
      showToast(`Invite sent to ${member.email}.`);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not send the invite.");
    } finally {
      setIsInviting(false);
    }
  };

  /**
   * Claims or releases this member record for the signed-in account.
   *
   * Not optimistic: a wrong link routes another person's schedule, so the list
   * is only updated once the server confirms. The cost is a brief spinner on an
   * action taken a handful of times per member, which is the right trade.
   */
  const updateMemberLink = async (
    member: TeamRosterMember,
    action: "link" | "unlink",
    targetUserId?: string,
  ) => {
    if (!canEdit || isUpdatingLink) return;
    setIsUpdatingLink(true);
    try {
      if (action === "link") {
        await linkTeamRosterMember(churchId, member.memberId, targetUserId);
      } else {
        await unlinkTeamRosterMember(churchId, member.memberId);
      }
      const next: TeamRosterMember = {
        ...member,
        userId:
          action === "link" ? targetUserId || currentUserId : undefined,
      };
      onSaved(next);
      // The open panel renders from `editing`, not from the list, so it has to
      // be advanced too — otherwise the status text and buttons keep showing
      // the pre-link state until the member is reopened.
      setEditing((current) =>
        current?.memberId === member.memberId ? next : current,
      );
      setShowAccountPicker(false);
      showToast(
        action === "link"
          ? targetUserId && targetUserId !== currentUserId
            ? "Linked to that account."
            : "Linked to your account."
          : "Unlinked from the account.",
      );
    } catch (error) {
      showApiErrorToast(
        showToast,
        error,
        action === "link"
          ? "Could not link this member to your account."
          : "Could not unlink this member.",
      );
    } finally {
      setIsUpdatingLink(false);
    }
  };

  const submit = async () => {
    if (!canEdit) return;
    const wasEditing = editing;
    const savingKey = wasEditing?.memberId ?? CREATE_SAVING_KEY;
    // Ignore a repeat submit for the same editor while its save is pending —
    // this prevents a fast double-click on "Create" from making duplicates.
    if (savingIds.has(savingKey)) return;
    setSavingIds((prev) => new Set(prev).add(savingKey));
    if (profileImageSelectionToastIdRef.current) {
      removeToast(profileImageSelectionToastIdRef.current);
      profileImageSelectionToastIdRef.current = null;
    }
    let body = {
      ...draft,
      blockoutDates: draft.blockoutDates.filter(
        (range) => range.startDate || range.endDate,
      ),
    };
    const previousProfileImagePublicId = wasEditing?.profileImagePublicId || "";
    const profileImageToUpload = pendingProfileImage;
    let profileImageUploadFailed = false;
    let uploadedProfileImagePublicId = "";
    try {
      if (profileImageToUpload) {
        setProfileImageUploading(true);
        try {
          const uploaded = await uploadImageToCloudinary(
            profileImageToUpload,
            context?.uploadPreset || "bpqu4ma5",
            "portable-media",
            {},
            { folder: `member-profiles/${churchId || "unassigned"}` },
          );
          uploadedProfileImagePublicId = uploaded.public_id;
          body = {
            ...body,
            profileImageUrl: uploaded.secure_url,
            profileImagePublicId: uploaded.public_id,
          };
        } catch (error) {
          profileImageUploadFailed = true;
          showApiErrorToast(
            showToast,
            error,
            "The member will be saved, but the profile image could not be uploaded.",
          );
        } finally {
          setProfileImageUploading(false);
        }
      }

      const saveToastMessage = formatMemberSaveToast(wasEditing, body, {
        positionNameById: new Map(
          positions.map((position) => [position.positionId, position.name]),
        ),
        teamNameById: new Map(data.teams.map((team) => [team.teamId, team.name])),
        roleNameById: new Map(
          data.teamRoles.map((role) => [role.roleId, role.name]),
        ),
        priorTeamIds: joinedTeamIds,
      });
      const localMemberId =
        wasEditing?.memberId || `local-member-${generateRandomId()}`;
      const optimisticMember: TeamRosterMember = {
        churchId,
        memberId: localMemberId,
        title: body.title?.trim() || "",
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email: (body.email || "").trim().toLowerCase(),
        birthDate: body.birthDate || null,
        isMinor: Boolean(body.isMinor),
        servingFrequency: body.servingFrequency || DEFAULT_SERVING_FREQUENCY,
        recurringAvailability:
          body.recurringAvailability || emptyRecurringAvailability(),
        positionIds: body.positionIds,
        desiredPositionIds: body.desiredPositionIds || [],
        teamMemberships: body.teamMemberships || {},
        qualifications: body.qualifications || [],
        blockoutDates: body.blockoutDates,
        notes: body.notes || "",
        profileImageUrl: body.profileImageUrl || "",
        profileImagePublicId: body.profileImagePublicId || "",
        archivedAt: wasEditing?.archivedAt || null,
      };
      const savedRecord = wasEditing
        ? { ...wasEditing, ...optimisticMember }
        : optimisticMember;
      onSaved(savedRecord);
      let response = wasEditing
        ? await updateTeamRosterMember(churchId, wasEditing.memberId, body)
        : await createTeamRosterMember(churchId, body);
      const finalMember: TeamRosterMember = {
        ...response.member,
        // Keep the editor's image fields authoritative when an older server
        // response omits optional profile-image fields.
        profileImageUrl:
          body.profileImageUrl !== undefined
            ? body.profileImageUrl
            : response.member.profileImageUrl || "",
        profileImagePublicId:
          body.profileImagePublicId !== undefined
            ? body.profileImagePublicId
            : response.member.profileImagePublicId || "",
      };
      const profileImagePublicIdToDelete =
        previousProfileImagePublicId &&
        previousProfileImagePublicId !== body.profileImagePublicId
          ? previousProfileImagePublicId
          : "";
      if (profileImagePublicIdToDelete) {
        void deleteCloudinaryAsset(profileImagePublicIdToDelete, "image");
      }
      if (!profileImageUploadFailed) {
        setPendingProfileImage(null);
        setPendingProfileImagePreviewUrl("");
        setDraft(
          buildMemberDraft(
            finalMember,
            readMemberTeamIds(finalMember, data.teams),
          ),
        );
      }
      if (!wasEditing) {
        onSaved(finalMember, localMemberId);
      } else if (!profileImageUploadFailed) {
        // The first optimistic save predates the Cloudinary upload. Reconcile
        // the list with the final member record once the image is linked.
        onSaved(finalMember, wasEditing.memberId);
      }
      // The server reconciles `team.memberIds` from the teams (and positions)
      // this save asked for. Apply the rosters it changed now so the Teams tab
      // and schedule reflect the join or removal right away, rather than
      // waiting for the next poll.
      response.teams?.forEach((team) => onTeamSaved(team));
      showToast(saveToastMessage, "success");
      if (profileImageUploadFailed) {
        showToast("You can choose the image again and save to retry.", "error");
      }
      // Cross-section return, or mobile where the form covers the list: close.
      // On desktop, keep the panel open for back-to-back editing.
      if (returnTo || isNarrowViewport) {
        finishEditing(reset);
      } else if (wasEditing) {
        // The operator may have switched to a different member while this save
        // was in flight. Only refresh the selected record if they're still on
        // the one we just saved, so the panel never rebinds to a stale member.
        setEditing((current) =>
          current?.memberId === wasEditing.memberId ? finalMember : current,
        );
      } else {
        // Newly created: adopt the saved record so a subsequent Save updates it
        // instead of creating a duplicate — but only if the create form is still
        // the active editor and the operator hasn't selected another member.
        const created = finalMember;
        setEditing((current) => (current === null ? created : current));
      }
    } catch (error) {
      if (uploadedProfileImagePublicId) {
        void deleteCloudinaryAsset(uploadedProfileImagePublicId, "image");
      }
      showApiErrorToast(showToast, error, "Could not save this member.");
      onArchived();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(savingKey);
        return next;
      });
    }
  };

  // The panel shows one editor at a time; its Save state reflects only the
  // member currently open, so a background save elsewhere never spins or
  // disables it.
  const currentEditorKey = editing ? editing.memberId : CREATE_SAVING_KEY;
  const isSavingCurrent = savingIds.has(currentEditorKey);
  const hasPendingChanges =
    JSON.stringify({ ...draft, teamIds: [...(draft.teamIds || [])].sort() }) !==
      JSON.stringify(buildMemberDraft(editing, joinedTeamIds)) ||
    Boolean(pendingProfileImage || pendingProfileImagePreviewUrl);
  useTeamsUnsavedChanges(hasPendingChanges);

  // Positions follow each team's Positions tab order; teams follow the roster list.
  const positionOptions = useMemo(
    () =>
      orderPositionsByTeamList(positions, data.teams).map((position) => ({
        id: position.positionId,
        label: position.name,
        sublabel: teamNameById.get(position.teamId) || "No team",
        archived: Boolean(position.archivedAt),
        // Positions whose team is missing share one "No team" filter chip.
        groupId: teamNameById.has(position.teamId)
          ? position.teamId
          : NO_TEAM_GROUP_ID,
      })),
    [positions, data.teams, teamNameById],
  );

  // Team filter chips for the position pickers: same order as the list, and only
  // teams that actually own a position.
  const positionTeamFilters = useMemo(() => {
    const labelById = new Map<string, string>();
    positionOptions.forEach((option) => {
      if (labelById.has(option.groupId)) return;
      labelById.set(option.groupId, option.sublabel);
    });
    return Array.from(labelById, ([id, label]) => ({ id, label }));
  }, [positionOptions]);
  const desiredPositionSelectableIds = useMemo(
    () =>
      positionOptions
        .filter(
          (option) =>
            !option.archived || (draft.desiredPositionIds || []).includes(option.id),
        )
        .map((option) => option.id),
    [draft.desiredPositionIds, positionOptions],
  );
  const desiredPositionsAllSelected =
    desiredPositionSelectableIds.length > 0 &&
    desiredPositionSelectableIds.every((id) =>
      (draft.desiredPositionIds || []).includes(id),
    );
  const toggleAllDesiredPositions = () => {
    const selected = new Set(draft.desiredPositionIds || []);
    if (desiredPositionsAllSelected) {
      desiredPositionSelectableIds.forEach((id) => selected.delete(id));
    } else {
      desiredPositionSelectableIds.forEach((id) => selected.add(id));
    }
    setDraft((current) => ({
      ...current,
      desiredPositionIds: Array.from(selected),
    }));
  };

  // Positions the member asked for (intake) but is not yet eligible to be
  // scheduled for. Promoting one adds it to positionIds (the assignment gate).
  const desiredNotEligible = useMemo(
    () =>
      (draft.desiredPositionIds || []).filter(
        (positionId) => !draft.positionIds.includes(positionId),
      ),
    [draft.desiredPositionIds, draft.positionIds],
  );

  const teamIdsForPositions = useCallback(
    (positionIds: string[]) =>
      Array.from(
        new Set(
          positionIds
            .map((positionId) => positionTeamIdById.get(positionId))
            .filter(Boolean) as string[],
        ),
      ),
    [positionTeamIdById],
  );

  const draftTeamIds = useMemo(() => draft.teamIds || [], [draft.teamIds]);
  // Membership is explicit now, so the teams that can hold a role are exactly
  // the teams selected below — including ones a position just added.
  const roleTeams = draftTeamIds
    .map((teamId) => data.teams.find((team) => team.teamId === teamId))
    .filter(Boolean) as TeamRecord[];

  const teamNamesFor = useCallback(
    (teamIds: string[]) =>
      teamIds
        .map((teamId) => teamNameById.get(teamId))
        .filter(Boolean) as string[],
    [teamNameById],
  );
  // Surface both directions so neither is a surprise on save.
  const teamsBeingJoined = teamNamesFor(
    draftTeamIds.filter((teamId) => !joinedTeamIds.includes(teamId)),
  );
  const teamIdsBeingLeft = joinedTeamIds.filter(
    (teamId) => !draftTeamIds.includes(teamId),
  );

  /**
   * Teams the member is still on but no longer has a position for, because this
   * draft removed their last one. Membership is add-only on the server, so
   * without a nudge here they would sit on the roster forever as an unassignable
   * row. Deliberate roster-only membership is real (trainees, shadow assignees),
   * so this offers the removal rather than doing it.
   */
  const teamsWithNoPositionsLeft = useMemo(() => {
    if (!editing) return [];
    const stillHasPosition = new Set(teamIdsForPositions(draft.positionIds));
    return teamIdsForPositions(editing.positionIds || [])
      .filter(
        (teamId) =>
          !stillHasPosition.has(teamId) &&
          draftTeamIds.includes(teamId) &&
          joinedTeamIds.includes(teamId),
      )
      .map((teamId) => ({
        teamId,
        name: teamNameById.get(teamId) || "this team",
        assignmentCount: countMemberAssignmentsOnTeam(
          editing.memberId,
          teamId,
          data.schedules,
        ),
      }));
  }, [
    data.schedules,
    draft.positionIds,
    draftTeamIds,
    editing,
    joinedTeamIds,
    teamIdsForPositions,
    teamNameById,
  ]);

  const teamOptions = useMemo(
    () =>
      data.teams.map((team) => ({
        id: team.teamId,
        label: team.name,
        icon: team.icon,
        archived: Boolean(team.archivedAt),
      })),
    [data.teams],
  );

  /**
   * Applying a team selection keeps the draft self-consistent: leaving a team
   * drops the positions and the role that only made sense while on it. Nothing
   * is saved until Save, so this stays reversible with Cancel.
   */
  const applyTeamSelection = (teamIds: string[]) => {
    setDraft((current) => {
      const nextTeamIds = new Set(teamIds);
      const teamMemberships = { ...(current.teamMemberships || {}) };
      Object.keys(teamMemberships).forEach((teamId) => {
        if (!nextTeamIds.has(teamId)) delete teamMemberships[teamId];
      });
      return {
        ...current,
        teamIds: [...teamIds].sort(),
        positionIds: current.positionIds.filter((positionId) => {
          const teamId = positionTeamIdById.get(positionId);
          return !teamId || nextTeamIds.has(teamId);
        }),
        teamMemberships,
      };
    });
  };

  /**
   * Choosing a position joins its team: eligibility for a team's position is
   * gated on belonging to that team, so the two cannot disagree. Unchecking a
   * position deliberately does not leave the team — see
   * `teamsWithNoPositionsLeft`.
   */
  const applyPositionSelection = (positionIds: string[]) => {
    setDraft((current) => ({
      ...current,
      positionIds,
      teamIds: Array.from(
        new Set([...(current.teamIds || []), ...teamIdsForPositions(positionIds)]),
      ).sort(),
    }));
  };
  const qualificationAreaOptions = data.qualificationAreas.map((area) => ({
    value: area.areaId,
    label: `${area.name}${teamNameById.get(area.teamId) ? ` (${teamNameById.get(area.teamId)})` : ""}`,
  }));

  const createEmptyQualification = (): TeamMemberQualification => ({
    qualificationId: `local-qualification-${generateRandomId()}`,
    areaId: data.qualificationAreas[0]?.areaId || "",
    levelId: data.qualificationAreas[0]
      ? data.qualificationLevels.find(
        (level) => level.areaId === data.qualificationAreas[0].areaId,
      )?.levelId || ""
      : "",
    teamId: data.qualificationAreas[0]?.teamId || "",
    status: "in_training",
  });

  return (
    <>
      <CreatePanel
        open={showCreate}
        onOpenCreate={() => {
          requestDiscardAction(() => {
            setShowFilters(false);
            reset();
            setShowCreate(true);
          });
        }}
        canEdit={canEdit}
        title={editing ? "Edit member" : "Create member"}
        sectionTitle={
          <>
            Members{" "}
            <span className="text-sm font-normal text-gray-400">
              ({filteredMembers.length}
              {listQuery || activeFilterCount > 0
                ? ` of ${membersInListScope.length}`
                : ""}
              )
            </span>
          </>
        }
        description="Keep roster details and availability current."
        createLabel="Create member"
        keepCreateActionVisible
        scrollableList
        listToolbar={
          members.length > 0 ? (
            <MemberListFilterToolbar
              data={data}
              listQuery={listQuery}
              onListQueryChange={setListQuery}
              filters={listFilters}
              onFiltersChange={(filters) => {
                setListFilters(filters);
                setDraftListFilters(filters);
              }}
              filtersOpen={showFilters}
              onFiltersOpenChange={handleFiltersOpenChange}
              onClearFilters={clearFilters}
            />
          ) : null
        }
        asideOpen={showFilters}
        asideId={MEMBER_FILTER_PANEL_ID}
        asideTitle="Filter members"
        asideHeaderActions={
          <Button
            type="button"
            variant="tertiary"
            svg={X}
            iconSize="sm"
            padding="p-0.5"
            className="shrink-0 text-gray-400 hover:text-white"
            aria-label="Close filters"
            onClick={cancelFilters}
          />
        }
        aside={
          <MemberFilterPanel
            data={data}
            value={draftListFilters}
            onChange={setDraftListFilters}
          />
        }
        asideFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Apply"
            onSave={applyFilters}
            onCancel={cancelFilters}
            hasPendingChanges={hasPendingFilterChanges}
          />
        }
        list={
          <>
            {members.length === 0 ? <p className="text-sm text-gray-300">No members yet.</p> : null}
            {members.length > 0 && filteredMembers.length === 0 ? (
              <p className="text-sm text-gray-300">
                {membersInListScope.length === 0 && !listQuery && activeFilterCount === 0
                  ? "Archived members are hidden. Open Filter to show them."
                  : "No matches."}
              </p>
            ) : null}
            {filteredMembers.map((member) => (
              <EntityRow
                key={member.memberId}
                compact
                title={memberName(member)}
                // Surfaced in the list, not only inside the form, so an admin
                // can see at a glance who a notification would never reach —
                // and fix it here, where addresses are entered.
                subtitle={
                  canNotifyMember(member) ? undefined : "No email"
                }
                archived={Boolean(member.archivedAt)}
                canEdit={canEdit}
                onTitleClick={() => selectMember(member)}
              />
            ))}
          </>
        }
        formHeaderActions={
          editing || returnTo ? (
            <TeamsReturnToolbar returnTo={returnTo} onBack={cancelEditing}>
              {editing ? (
                <EntityFormDangerActions
                  archived={Boolean(editing.archivedAt)}
                  canEdit={canEdit}
                  archiveLabel="Archive member"
                  deleteLabel="Delete member"
                  menuLabel="Member actions"
                  onArchive={
                    editing.archivedAt
                      ? undefined
                      : async () => {
                        const archivedMember = {
                          ...editing,
                          archivedAt: new Date().toISOString(),
                        };
                        onSaved(archivedMember);
                        try {
                          await archiveTeamRosterMember(churchId, editing.memberId);
                          finishEditing(reset);
                        } catch (error) {
                          showApiErrorToast(showToast, error, "Could not archive this member.");
                          onSaved(editing);
                        }
                      }
                  }
                  onDelete={() => setDeleting(editing)}
                />
              ) : null}
            </TeamsReturnToolbar>
          ) : null
        }
        formFooter={
          <FormActionButtons
            pinFooter
            saveLabel="Save member"
            onSave={() => void submit()}
            onCancel={cancelEditing}
            hasPendingChanges={hasPendingChanges}
            disabled={
              !canEdit ||
              !draft.firstName.trim() ||
              !draft.lastName.trim() ||
              // The server rejects a malformed address, so blocking here turns
              // a failed round-trip into an inline message.
              Boolean(emailError) ||
              isSavingCurrent ||
              profileImageUploading
            }
            isLoading={isSavingCurrent}
          />
        }
      >
        <fieldset className="space-y-2 rounded-md border border-gray-700 bg-gray-950/40 p-3 pt-0">
          <legend className="px-1 text-sm font-semibold">Member details</legend>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Input
              label="Title"
              placeholder="e.g. Dr."
              value={draft.title || ""}
              onChange={(title) => setDraft((d) => ({ ...d, title: String(title) }))}
            />
            <Input label="First name" value={draft.firstName} onChange={(firstName) => setDraft((d) => ({ ...d, firstName: String(firstName) }))} />
            <Input label="Last name" value={draft.lastName} onChange={(lastName) => setDraft((d) => ({ ...d, lastName: String(lastName) }))} />
          </div>
          {/* Optional: existing members have no address, and requiring one would
            block saving them. Used for notifications only — never to identify
            which account this member is. */}
          {/*
          One effective address per person, never two.

          Linked: the account email is it. They control it and can change it,
          whereas an admin-typed copy would go stale while still looking
          authoritative — and sending to both would mean checking two inboxes.
          So the editable field is hidden rather than left looking meaningful.

          Unlinked: this field is the only way to reach them.

          Reaching an additional person (a parent for a teen volunteer) is a
          real need, but it belongs in a deliberate additional-recipients
          feature, not in an ambiguous second field.
        */}
          {editing?.userId ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-gray-300">Email</span>
              <span className="text-sm">
                {linkedAccountEmail || "From their account"}
              </span>
              <span className="text-xs text-gray-400">
                Comes from their account. Unlink to set an address here instead.
              </span>
            </div>
          ) : (
            <Input
              label="Email"
              type="email"
              value={draft.email || ""}
              errorText={emailError}
              onChange={(email) =>
                setDraft((d) => ({ ...d, email: String(email) }))
              }
            />
          )}
          {/* Account link. Separate from the email above on purpose: an address is
            a contact detail, the link is an identity, and one never implies the
            other. Only shown for saved members — there is nothing to link yet
            while creating one. */}
          {editing ? (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                {/* Naming the other account would need it on the roster payload;
                  the picker's list is only loaded on demand, so reading from it
                  here would show a name sometimes and not others. */}
                <span className="text-gray-300">
                  {/* The address itself is shown by the Email block above, so
                    this only says whose account it is. */}
                  {editing.userId
                    ? editing.userId === currentUserId
                      ? "Linked to your account."
                      : "Linked to their account."
                    : editing.invitedAt
                      ? "Invite sent. Not linked until they accept."
                      : "Not linked to an account."}
                </span>
                {editing.userId ? (
                  <Button
                    variant="tertiary"
                    disabled={!canEdit || isUpdatingLink}
                    isLoading={isUpdatingLink}
                    onClick={() => void updateMemberLink(editing, "unlink")}
                  >
                    Unlink
                  </Button>
                ) : selfLinkedMember ? (
                  // Someone else's record and this account is already claimed:
                  // the remaining path is inviting them to make their own.
                  null
                ) : (
                  // Offered only while this account has claimed no one. With a
                  // claim already made the server would reject this, so showing
                  // it would be an action guaranteed to fail.
                  <Button
                    variant="tertiary"
                    disabled={!canEdit || isUpdatingLink}
                    isLoading={isUpdatingLink}
                    onClick={() => void updateMemberLink(editing, "link")}
                  >
                    This is me
                  </Button>
                )}
              </div>
              {/* Only accounts already in this church are offered — the server
                refuses anything else, so showing more would only produce
                errors. Accounts already linked to another member are excluded
                rather than shown and rejected. */}
              {!editing.userId && canEdit && isChurchAdmin ? (
                showAccountPicker ? (
                  <SearchableSelect
                    variant="dark"
                    label="Link an account"
                    value=""
                    placeholder="Choose an account…"
                    options={linkableAccounts}
                    onChange={(userId) => {
                      if (!userId) return;
                      void updateMemberLink(editing, "link", userId);
                    }}
                  />
                ) : (
                  <Button
                    variant="textLink"
                    padding="p-0"
                    disabled={isUpdatingLink}
                    onClick={() => setShowAccountPicker(true)}
                  >
                    Link an account
                  </Button>
                )
              ) : null}
              {/* For someone who has no account at all.
                Always rendered rather than hidden behind having an address: a
                roster that has never collected emails would show this nowhere,
                so the action would look like it does not exist. Disabled with
                the reason is discoverable; absent is not.
                The invite sends to the *saved* address, so an unsaved edit
                blocks it too — otherwise it would quietly mail the old one. */}
              {!editing.userId && canEdit && isChurchAdmin ? (
                <div className="flex flex-col gap-1">
                  <Button
                    variant="textLink"
                    padding="p-0"
                    disabled={isInviting || !canInviteMember}
                    isLoading={isInviting}
                    onClick={() => void inviteMemberToAccount(editing)}
                  >
                    Invite them to create an account
                  </Button>
                  {canInviteMember ? null : (
                    <span className="text-xs text-gray-400">
                      {editing.email
                        ? "Save your email change first."
                        : "Add an email above and save to invite them."}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Profile image</span>
            <span className="text-xs text-gray-400">
              Public image used when this member appears in the roster and schedules.
            </span>
            <div className="flex flex-wrap items-center gap-3">
            {pendingProfileImagePreviewUrl || draft.profileImageUrl ? (
              <img
                src={pendingProfileImagePreviewUrl || draft.profileImageUrl}
                  alt={`${draft.firstName || "Member"} profile`}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-700 text-gray-300">
                  <Camera aria-hidden="true" size={22} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="tertiary"
                  svg={Camera}
                  isLoading={profileImageUploading}
                  disabled={!canEdit || profileImageUploading}
                  onClick={() => profileImageInputRef.current?.click()}
                >
                  {draft.profileImageUrl ? "Replace image" : "Choose image"}
                </Button>
              {pendingProfileImagePreviewUrl || draft.profileImageUrl ? (
                  <Button
                    type="button"
                    variant="textLink"
                    disabled={!canEdit || profileImageUploading}
                  onClick={() => {
                    setPendingProfileImage(null);
                    setPendingProfileImagePreviewUrl("");
                    setDraft((current) => ({
                      ...current,
                      profileImageUrl: "",
                      profileImagePublicId: "",
                    }));
                  }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <input
                ref={profileImageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Profile image upload"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadProfileImage(file);
                }}
              />
            </div>
          </div>
          <BirthDateField
            label="Birthday"
            value={draft.birthDate}
            onChange={(birthDate) =>
              setDraft((current) => ({
                ...current,
                birthDate,
                isMinor: isMinorOnDate(birthDate) ?? Boolean(current.isMinor),
              }))
            }
          />
          <Checkbox
            label={(
              <span className="flex flex-col gap-0.5">
                <span>Minor</span>
                <span className="text-xs text-gray-400">
                  {derivedMinorStatus === null
                    ? "Hides their last name from generated credits."
                    : "Set automatically when the birth year is provided."}
                </span>
              </span>
            )}
            checked={derivedMinorStatus ?? Boolean(draft.isMinor)}
            disabled={derivedMinorStatus !== null}
            onCheckedChange={(isMinor) =>
              setDraft((current) => ({ ...current, isMinor }))
            }
          />
        </fieldset>
        <fieldset className="space-y-2 rounded-md border border-gray-700 bg-gray-950/40 p-3 pt-0">
          <legend className="px-1 text-sm font-semibold">Scheduling preferences</legend>
          <div className="flex flex-col gap-1">
            <Select
            label="Serving frequency"
              value={draft.servingFrequency || DEFAULT_SERVING_FREQUENCY}
              options={servingFrequencyOptions}
              onChange={(servingFrequency) =>
                setDraft((current) => ({
                  ...current,
                  servingFrequency:
                    servingFrequency as TeamRosterMember["servingFrequency"],
                }))
              }
            />
            <span className="text-xs text-gray-400">
              Used as a preference for recommendations and auto-fill, not as a
              scheduling limit.
            </span>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Recurring availability</legend>
            <p className="text-xs text-gray-400">
              Leave every week unchecked if this member can serve any week. Selected weeks are a scheduling limit.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {recurringAvailabilityWeekOptions.map((option) => {
                const selectedWeeks = draft.recurringAvailability?.weeksOfMonth || [];
                const checked = selectedWeeks.includes(option.value);
                return (
                  <Checkbox
                    key={option.value}
                    label={option.label}
                    checked={checked}
                    onCheckedChange={(nextChecked) =>
                      setDraft((current) => {
                        const currentAvailability =
                          current.recurringAvailability || emptyRecurringAvailability();
                        const weeksOfMonth = nextChecked
                          ? [...currentAvailability.weeksOfMonth, option.value].sort()
                          : currentAvailability.weeksOfMonth.filter(
                            (week) => week !== option.value,
                          );
                        return {
                          ...current,
                          recurringAvailability: {
                            ...currentAvailability,
                            weeksOfMonth,
                          },
                        };
                      })
                    }
                  />
                );
              })}
              <Checkbox
                label="Last week"
                checked={Boolean(draft.recurringAvailability?.includeLastWeekOfMonth)}
                onCheckedChange={(includeLastWeekOfMonth) =>
                  setDraft((current) => ({
                    ...current,
                    recurringAvailability: {
                      ...(current.recurringAvailability || emptyRecurringAvailability()),
                      includeLastWeekOfMonth,
                    },
                  }))
                }
              />
            </div>
          </fieldset>
        </fieldset>
        <EntityMultiSelect
          label="Teams"
          description="Rosters this member belongs to. Choosing a position below adds its team automatically."
          options={teamOptions}
          value={draftTeamIds}
          onChange={applyTeamSelection}
          emptyText="No teams yet."
        />
        <EntityMultiSelect
          label="Positions"
          description="Positions this member can be scheduled for."
          options={positionOptions}
          groups={positionTeamFilters}
          groupFilterLabel="Filter positions by team"
          allGroupsLabel="All teams"
          value={draft.positionIds}
          onChange={applyPositionSelection}
          renderOptionAction={
            canEdit
              ? (option) => {
                const teamIdForPosition = positionTeamIdById.get(option.id);
                if (!teamIdForPosition) return null;
                return (
                  <TeamsCrossSectionLink
                    to={buildTeamsPositionEditPath(option.id, teamIdForPosition)}
                    returnTo={
                      editing
                        ? {
                          label: "Back to member",
                          pathname: buildTeamsMemberEditPath(editing.memberId),
                        }
                        : buildSectionReturnTo(TEAMS_SECTION_PATHS.members)
                    }
                    aria-label={`Edit ${option.label}`}
                  >
                    Edit
                  </TeamsCrossSectionLink>
                );
              }
              : undefined
          }
        />
        {teamsBeingJoined.length > 0 ? (
          <p className="rounded-md border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100/90">
            Saving will add {draft.firstName.trim() || "this member"} to{" "}
            <span className="font-semibold">
              {formatTeamNameList(teamsBeingJoined)}
            </span>
            .
          </p>
        ) : null}
        {teamIdsBeingLeft.length > 0 ? (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
            <p>
              Saving will remove {draft.firstName.trim() || "this member"} from{" "}
              <span className="font-semibold">
                {formatTeamNameList(teamNamesFor(teamIdsBeingLeft))}
              </span>
              .
            </p>
            {editing
              ? teamIdsBeingLeft.map((teamId) => {
                const assignmentCount = countMemberAssignmentsOnTeam(
                  editing.memberId,
                  teamId,
                  data.schedules,
                );
                if (!assignmentCount) return null;
                return (
                  <p key={teamId} className="mt-1">
                    They are still assigned{" "}
                    {assignmentCount === 1
                      ? "once"
                      : `${assignmentCount} times`}{" "}
                    on {teamNameById.get(teamId) || "that team"} schedules.
                    Those assignments stay as they are.
                  </p>
                );
              })
              : null}
          </div>
        ) : null}
        {teamsWithNoPositionsLeft.map((team) => (
          <div
            key={team.teamId}
            className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3"
          >
            <p className="text-sm font-semibold text-amber-100">
              No {team.name} positions left
            </p>
            <p className="mt-0.5 text-xs text-amber-100/80">
              They stay on the {team.name} roster and can still be shadowed in.
              {team.assignmentCount
                ? ` They are assigned ${team.assignmentCount === 1
                  ? "once"
                  : `${team.assignmentCount} times`
                } on ${team.name} schedules.`
                : ""}
            </p>
            <div className="mt-2">
              <Button
                variant="secondary"
                svg={X}
                iconSize="sm"
                padding="px-2 py-1"
                onClick={() =>
                  applyTeamSelection(
                    draftTeamIds.filter((teamId) => teamId !== team.teamId),
                  )
                }
              >
                Remove from {team.name}
              </Button>
            </div>
          </div>
        ))}
        {desiredNotEligible.length > 0 ? (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-100">
              Requested from intake, not yet schedulable
            </p>
            <p className="mt-0.5 text-xs text-amber-100/80">
              These positions are what the member wants to do. Add one to make
              them assignable to it.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {desiredNotEligible.map((positionId) => (
                <Button
                  key={positionId}
                  variant="secondary"
                  svg={Plus}
                  iconSize="sm"
                  padding="px-2 py-1"
                  onClick={() =>
                    applyPositionSelection([...draft.positionIds, positionId])
                  }
                >
                  {positionNameById.get(positionId) || "Position"}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="min-w-0 space-y-1">
          <CollapsibleSectionTrigger
            label="Desired positions"
            expanded={showDesiredPositions}
            onExpandedChange={setShowDesiredPositions}
            endContent={
              <span
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <SelectAllButton
                  allSelected={desiredPositionsAllSelected}
                  tone="admin"
                  onClick={toggleAllDesiredPositions}
                />
              </span>
            }
          />
          {showDesiredPositions ? (
            <EntityMultiSelect
              label="Desired positions"
              hideLabel
              hideSelectAll
              description="What the member wants to do, from intake forms. Does not affect scheduling on its own."
              options={positionOptions}
              groups={positionTeamFilters}
              groupFilterLabel="Filter desired positions by team"
              allGroupsLabel="All teams"
              value={draft.desiredPositionIds || []}
              onChange={(desiredPositionIds) =>
                setDraft((d) => ({ ...d, desiredPositionIds }))
              }
            />
          ) : null}
        </div>
        <fieldset className="space-y-2">
          <legend className="p-1 text-sm font-semibold">Team roles</legend>
          {roleTeams.length === 0 ? (
            <p className="text-sm text-gray-400">
              Choose a team above to assign a team role.
            </p>
          ) : null}
          {roleTeams.map((team) => {
            const membership = draft.teamMemberships?.[team.teamId] || {
              teamId: team.teamId,
            };
            const roleOptions = [
              { value: NO_SELECTION_VALUE, label: "No role" },
              ...data.teamRoles
                .filter((role) => role.teamId === team.teamId)
                .map((role) => ({
                  value: role.roleId,
                  label: `${role.name}${role.archivedAt ? " (archived)" : ""}`,
                })),
            ];
            return (
              <div
                key={team.teamId}
                className="rounded-md border border-gray-700 bg-gray-950/60 p-2"
              >
                <Select
                  label={`${team.name} role`}
                  value={membership.roleId || NO_SELECTION_VALUE}
                  options={roleOptions}
                  onChange={(roleId) =>
                    setDraft((current) => {
                      const teamMemberships = { ...(current.teamMemberships || {}) };
                      const existing = teamMemberships[team.teamId] || {
                        teamId: team.teamId,
                      };
                      teamMemberships[team.teamId] = {
                        ...existing,
                        roleId:
                          roleId === NO_SELECTION_VALUE ? undefined : roleId,
                        roleLabel:
                          roleId === NO_SELECTION_VALUE
                            ? undefined
                            : roleById.get(roleId)?.name || existing.roleLabel,
                      };
                      return { ...current, teamMemberships };
                    })
                  }
                  selectClassName="w-full"
                />
              </div>
            );
          })}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="p-1 text-sm font-semibold">Qualifications</legend>
          {data.qualificationAreas.length === 0 ? (
            <p className="text-sm text-gray-400">
              Add qualification areas before assigning training levels.
            </p>
          ) : null}
          {(draft.qualifications || []).map((qualification, index) => {
            const selectedArea = areaById.get(qualification.areaId);
            const levelOptions = [
              { value: NO_SELECTION_VALUE, label: "No level" },
              ...data.qualificationLevels
                .filter((level) => level.areaId === qualification.areaId)
                .sort((a, b) => a.rank - b.rank)
                .map((level) => ({
                  value: level.levelId,
                  label: `${level.name}${level.archivedAt ? " (archived)" : ""}`,
                })),
            ];
            return (
              <div
                key={qualification.qualificationId || index}
                className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2"
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Select
                    label="Area"
                    value={qualification.areaId || NO_SELECTION_VALUE}
                    options={[
                      { value: NO_SELECTION_VALUE, label: "Choose area" },
                      ...qualificationAreaOptions,
                    ]}
                    onChange={(areaId) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                ...item,
                                areaId:
                                  areaId === NO_SELECTION_VALUE ? "" : areaId,
                                teamId:
                                  areaId === NO_SELECTION_VALUE
                                    ? ""
                                    : areaById.get(areaId)?.teamId || "",
                                levelId: "",
                              }
                              : item,
                        ),
                      }))
                    }
                    selectClassName="w-full"
                  />
                  <Select
                    label="Level"
                    value={qualification.levelId || NO_SELECTION_VALUE}
                    options={levelOptions}
                    onChange={(levelId) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                ...item,
                                levelId:
                                  levelId === NO_SELECTION_VALUE
                                    ? undefined
                                    : levelId,
                              }
                              : item,
                        ),
                      }))
                    }
                    selectClassName="w-full"
                  />
                  <Select
                    label="Status"
                    value={qualification.status || "in_training"}
                    options={qualificationStatusOptions}
                    onChange={(status) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                ...item,
                                status: status as TeamMemberQualificationStatus,
                              }
                              : item,
                        ),
                      }))
                    }
                    selectClassName="w-full"
                  />
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={X}
                    iconSize="sm"
                    padding="p-0"
                    className="shrink-0 self-center text-gray-400 hover:text-white"
                    aria-label="Remove qualification"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <DatePicker
                    label="Completed"
                    value={qualification.completedAt || ""}
                    onChange={(completedAt) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index ? { ...item, completedAt } : item,
                        ),
                      }))
                    }
                  />
                  <DatePicker
                    label="Expires"
                    value={qualification.expiresAt || ""}
                    onChange={(expiresAt) =>
                      setDraft((current) => ({
                        ...current,
                        qualifications: (current.qualifications || []).map(
                          (item, itemIndex) =>
                            itemIndex === index ? { ...item, expiresAt } : item,
                        ),
                      }))
                    }
                  />
                </div>
                <Input
                  label="Notes"
                  hideLabel
                  placeholder={
                    selectedArea
                      ? `Notes for ${selectedArea.name}`
                      : "Qualification notes"
                  }
                  value={qualification.notes || ""}
                  onChange={(notes) =>
                    setDraft((current) => ({
                      ...current,
                      qualifications: (current.qualifications || []).map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, notes: String(notes) }
                            : item,
                      ),
                    }))
                  }
                />
              </div>
            );
          })}
          <Button
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            disabled={data.qualificationAreas.length === 0}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                qualifications: [
                  ...(current.qualifications || []),
                  createEmptyQualification(),
                ],
              }))
            }
          >
            Add qualification
          </Button>
        </fieldset>
        <BlockoutDatesField
          key={editing?.memberId ?? "new-member"}
          variant="admin"
          label="Blockout dates"
          showNotes
          emptyLabel="No blockout dates added."
          value={draft.blockoutDates}
          onChange={(blockoutDates) =>
            setDraft((current) => ({ ...current, blockoutDates }))
          }
        />
        <TextArea label="Notes" value={draft.notes || ""} textareaClassName="min-h-24" onChange={(notes) => setDraft((d) => ({ ...d, notes }))} />
      </CreatePanel>
      <DeleteModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        itemName={deleting ? memberName(deleting) : undefined}
        isConfirming={deleteBusy}
        message="Permanently delete the member"
        impacts={deleting ? describeDeletionImpacts("member", deleting.memberId, data) : undefined}
        warningMessage="This cannot be undone. Archive instead if you only want to hide them."
      />
    </>
  );
};

const formatTeamNameList = (names: string[]) => {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
};

export default MemberManager;
