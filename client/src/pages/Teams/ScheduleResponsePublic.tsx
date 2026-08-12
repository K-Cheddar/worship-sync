import { useCallback, useContext, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Check, X } from "lucide-react";
import AuthScreenMain from "../../components/AuthScreenMain";
import Button from "../../components/Button/Button";
import ButtonGroup from "../../components/Button/ButtonGroup";
import ButtonGroupItem from "../../components/Button/ButtonGroupItem";
import {
  getAssignmentResponseContext,
  requestAccountFromAssignmentToken,
  respondToAssignmentByToken,
  type AssignmentResponseSlot,
} from "../../api/auth";
import { getApiErrorMessage } from "../../utils/apiErrorToast";
import { GlobalInfoContext } from "../../context/globalInfo";
import { cn } from "@/utils/cnHelper";

/**
 * Answering schedule assignments from an emailed link.
 *
 * Public and sessionless on purpose. `/my-schedule` would be the natural home —
 * it already shows the plan, the team, and the same buttons — but it sits behind
 * `AuthGate`, and the reader here usually has **no account at all**. Roster and
 * account list are deliberately separate, so requiring sign-in would lock out
 * exactly the people this email exists to reach.
 *
 * The link covers every service the reader was asked about, listed with names
 * and dates. The first version answered one slot per link and named none of
 * them: "Can you serve at this service?" with no way to tell which.
 */

const formatWhen = (startsAt: string): string => {
  if (!startsAt) return "Date to be confirmed";
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "Date to be confirmed";
  return parsed.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const STATE_LABEL: Record<string, { text: string; className: string }> = {
  accepted: { text: "Accepted", className: "text-emerald-300" },
  declined: { text: "Declined", className: "text-red-400" },
};

const ScheduleResponsePublic = () => {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  /**
   * Someone already signed in has a strictly better surface than this one:
   * `/my-schedule` shows the order of service, who else is on, and their own
   * time off. Point them at it once the answer is recorded rather than leaving
   * them on the thin page the email needed.
   */
  const globalInfo = useContext(GlobalInfoContext);
  const isSignedIn = Boolean(globalInfo?.user);
  /**
   * The answer the reader clicked in their email. Acting on it here — rather
   * than on the server's GET — is what keeps mail-security scanners from
   * answering for them: a scanner fetches links but does not run this app.
   */
  const intent = searchParams.get("respond");
  const clickedResponse =
    intent === "accepted" || intent === "declined" ? intent : null;
  const [slots, setSlots] = useState<AssignmentResponseSlot[]>([]);
  const [churchName, setChurchName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  /**
   * The invite is only ever addressed to the email already on the roster
   * record, so there is no field to fill in here — just the outcome, naming the
   * inbox so the reader knows where to look.
   */
  const [inviteState, setInviteState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");

  const load = useCallback(async () => {
    try {
      // One click in the email is the answer. Apply it straight away and show
      // the result, rather than making the reader choose the same thing twice.
      const result = clickedResponse
        ? await respondToAssignmentByToken({
            token,
            response: clickedResponse,
          }).then(async (saved) => ({
            ...(await getAssignmentResponseContext(token)),
            assignments: saved.assignments,
          }))
        : await getAssignmentResponseContext(token);
      setSlots(result.assignments || []);
      setChurchName(result.churchName || "");
      setFirstName(result.firstName || "");
      setStatus("ready");
    } catch (caught) {
      // The server tells expired from invalid apart, and each needs a different
      // next step, so its wording is shown rather than a generic line.
      setError(
        getApiErrorMessage(
          caught,
          "Could not open this link. Ask your team lead to resend it.",
        ),
      );
      setStatus("error");
    }
  }, [clickedResponse, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (
    response: "accepted" | "declined",
    slot?: AssignmentResponseSlot,
  ) => {
    setBusy(slot ? `${slot.occurrenceId}|${slot.cellKey}` : "all");
    setError("");
    try {
      const result = await respondToAssignmentByToken({
        token,
        response,
        ...(slot
          ? { occurrenceId: slot.occurrenceId, cellKey: slot.cellKey }
          : {}),
      });
      // The returned slots carry the new state, which is what `answered` reads.
      setSlots(result.assignments || []);
    } catch (caught) {
      setError(
        getApiErrorMessage(caught, "Could not save your response. Try again."),
      );
    } finally {
      setBusy("");
    }
  };

  const requestAccount = async () => {
    setInviteState("sending");
    setInviteError("");
    try {
      const result = await requestAccountFromAssignmentToken(token);
      setInviteEmail(result.email || "");
      setInviteState("sent");
    } catch (caught) {
      // "You already have an account", "you are not on the roster" and "we have
      // no address for you" each need a different next step, so the server's
      // wording is shown rather than one generic line.
      setInviteError(
        getApiErrorMessage(
          caught,
          "Could not send your invite. Ask your team lead for one.",
        ),
      );
      setInviteState("idle");
    }
  };

  const unanswered = slots.filter((slot) => slot.response === "pending");
  /**
   * Derived from the slots, not from having clicked this visit. Someone who
   * answered yesterday and reopens the bare link — no `?respond=` — has still
   * answered, and the page has to agree with the "You said: Accepted" it is
   * already showing them. Reading it off local state instead left them asked the
   * question again and hid the account offer for good.
   */
  const answered = slots.some((slot) => slot.response !== "pending");
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  return (
    <AuthScreenMain>
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900/70 p-6">
        {status === "loading" ? (
          <p className="text-sm text-gray-300">Loading your services…</p>
        ) : null}

        {status === "error" ? (
          <>
            <h1 className="text-lg font-semibold text-white">
              This link cannot be opened
            </h1>
            <p className="mt-2 text-sm text-gray-300">{error}</p>
          </>
        ) : null}

        {status === "ready" ? (
          <>
            <h1 className="text-lg font-semibold text-white">
              {answered
                ? "Thanks — your team lead has your answer"
                : slots.length === 1
                  ? "Can you serve at this service?"
                  : "Can you serve at these services?"}
            </h1>
            <p className="mt-2 text-sm text-gray-300">
              {greeting}{" "}
              {answered
                ? `${churchName || "Your team"} can see your response. Change any of it below if you need to.`
                : `${churchName || "Your team"} has you on the schedule.`}
            </p>

            {error ? (
              <p className="mt-4 text-sm text-red-400">{error}</p>
            ) : null}

            {slots.length === 0 ? (
              <p className="mt-4 text-sm text-gray-300">
                You are not on this schedule any more. Nothing to answer.
              </p>
            ) : null}

            <ul className="mt-4 space-y-2">
              {slots.map((slot) => {
                const key = `${slot.occurrenceId}|${slot.cellKey}`;
                const state = STATE_LABEL[slot.response];
                return (
                  <li
                    key={key}
                    className="rounded-lg border border-gray-700/80 bg-gray-950/50 p-3"
                  >
                    <p className="text-sm font-semibold text-gray-50">
                      {slot.serviceName}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatWhen(slot.startsAt)}
                    </p>
                    {slot.positionName ? (
                      <p className="mt-0.5 text-xs text-orange-300">
                        {slot.positionName}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {state ? (
                        <span className={cn("text-xs font-medium", state.className)}>
                          You said: {state.text}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">
                          No answer yet
                        </span>
                      )}
                      <ButtonGroup className="border-gray-500" display="flex">
                        <ButtonGroupItem
                          type="button"
                          variant="primary"
                          iconSize="sm"
                          svg={Check}
                          color="#6ee7b7"
                          className="max-md:min-h-0"
                          disabled={Boolean(busy)}
                          isSelected={slot.response === "accepted"}
                          aria-label={`Accept ${slot.serviceName}`}
                          onClick={() => respond("accepted", slot)}
                        >
                          Accept
                        </ButtonGroupItem>
                        <ButtonGroupItem
                          type="button"
                          variant="primary"
                          iconSize="sm"
                          svg={X}
                          color="#fca5a5"
                          className="max-md:min-h-0"
                          disabled={Boolean(busy)}
                          isSelected={slot.response === "declined"}
                          aria-label={`Decline ${slot.serviceName}`}
                          onClick={() => respond("declined", slot)}
                        >
                          Decline
                        </ButtonGroupItem>
                      </ButtonGroup>
                    </div>
                  </li>
                );
              })}
            </ul>

            {answered ? (
              <div className="mt-5 border-t border-gray-800 pt-4">
                {isSignedIn ? (
                  <p className="text-sm text-gray-300">
                    You are signed in.{" "}
                    <a
                      href="#/my-schedule"
                      className="text-cyan-300 underline underline-offset-2"
                    >
                      Open My schedule
                    </a>{" "}
                    to see the plan and set your time off.
                  </p>
                ) : inviteState === "sent" ? (
                  <p className="text-sm text-emerald-300">
                    Invite sent{inviteEmail ? ` to ${inviteEmail}` : ""}. Open it
                    to finish setting up your account.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-gray-400">
                      Want the full plan, reminders, and a place to set your time
                      off?
                    </p>
                    {/* No email field on purpose: the invite goes to the address
                        your team already has, which is the inbox this link
                        arrived in. */}
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2 max-md:min-h-0"
                      disabled={inviteState === "sending"}
                      onClick={() => void requestAccount()}
                    >
                      {inviteState === "sending"
                        ? "Sending…"
                        : "Email me an invite"}
                    </Button>
                    {inviteError ? (
                      <p className="mt-2 text-sm text-red-400">{inviteError}</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {/* Only worth offering while something is actually unanswered —
                a bulk control over decisions already made invites mistakes. */}
            {unanswered.length > 1 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-4">
                <span className="text-xs text-gray-400">
                  Same answer for all {unanswered.length}?
                </span>
                <Button
                  type="button"
                  variant="cta"
                  svg={Check}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  disabled={Boolean(busy)}
                  onClick={() => respond("accepted")}
                >
                  Accept all
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  svg={X}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  disabled={Boolean(busy)}
                  onClick={() => respond("declined")}
                >
                  Decline all
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </AuthScreenMain>
  );
};

export default ScheduleResponsePublic;
