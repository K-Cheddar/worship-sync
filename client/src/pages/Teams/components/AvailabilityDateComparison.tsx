import { useState } from "react";
import { Check, CircleMinus, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import Select from "../../../components/Select/Select";
import type { TeamIntakeForm, TeamRecord } from "../../../api/authTypes";
import type { AvailabilityProgressRow } from "../availabilityFormProgress";
import {
  formatPlainDateRangeLabel,
  formatShortOccurrenceDate,
  memberName,
} from "../teamsUtils";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";

type Category =
  | "all"
  | "available"
  | "unavailable"
  | "incomplete"
  | "no-response"
  | "details-unavailable";

const PAGE_SIZE = 50;

const AvailabilityDateComparison = ({
  rows,
  form,
  teams,
  serviceTimeZone,
  isOpen,
  onClose,
}: {
  rows: AvailabilityProgressRow[];
  form: TeamIntakeForm;
  teams: TeamRecord[];
  serviceTimeZone: string;
  isOpen: boolean;
  onClose: () => void;
}) => {
  const occurrences = form.availabilityOccurrences || [];
  const [occurrenceId, setOccurrenceId] = useState(occurrences[0]?.occurrenceId || "");
  const [teamId, setTeamId] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [page, setPage] = useState(0);
  const occurrence = occurrences.find((item) => item.occurrenceId === occurrenceId) || occurrences[0];

  const dateLabel = (item: (typeof occurrences)[number]) => {
    if (item.serviceDate)
      return formatPlainDateRangeLabel(item.serviceDate, item.serviceDate);
    if (serviceTimeZone)
      return formatShortOccurrenceDate(item.startsAt, serviceTimeZone);
    return "Date unavailable";
  };
  const teamsForForm = teams.filter((team) => !team.archivedAt);
  const scopedRows = rows.filter(
    (row) =>
      row.status !== "Revoked" &&
      (!teamId || row.memberTeamIds.has(teamId)),
  );
  const answerFor = (row: AvailabilityProgressRow) => {
    if (row.status !== "Responded" || !row.hasResponseDetails || !occurrence)
      return undefined;
    return row.occurrenceAvailability[occurrence.occurrenceId];
  };
  const isIncomplete = (row: AvailabilityProgressRow) =>
    row.status === "Responded" && row.hasResponseDetails && !answerFor(row);
  const hasUnavailableDetails = (row: AvailabilityProgressRow) =>
    row.status === "Responded" && !row.hasResponseDetails;
  const counts = {
    available: scopedRows.filter((row) => answerFor(row) === "available").length,
    unavailable: scopedRows.filter((row) => answerFor(row) === "unavailable").length,
    incomplete: scopedRows.filter(isIncomplete).length,
    noResponse: scopedRows.filter((row) => row.status !== "Responded").length,
    detailsUnavailable: scopedRows.filter(hasUnavailableDetails).length,
  };
  const visibleRows = scopedRows.filter((row) => {
    if (category === "available") return answerFor(row) === "available";
    if (category === "unavailable") return answerFor(row) === "unavailable";
    if (category === "incomplete") return isIncomplete(row);
    if (category === "no-response") return row.status !== "Responded";
    if (category === "details-unavailable") return hasUnavailableDetails(row);
    return true;
  });
  const pageCount = Math.ceil(visibleRows.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const pageRows = visibleRows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const categoryOptions = [
    { value: "all", label: "All volunteers" },
    { value: "available", label: "Available" },
    { value: "unavailable", label: "Unavailable" },
    { value: "incomplete", label: "Incomplete answer" },
    { value: "no-response", label: "No response" },
    { value: "details-unavailable", label: "Response details unavailable" },
  ];

  const answerLabel = (row: AvailabilityProgressRow) => {
    const answer = answerFor(row);
    if (answer === "available") return "Available";
    if (answer === "unavailable") return "Unavailable";
    if (row.status === "Responded" && row.hasResponseDetails) return "No answer";
    if (row.status === "Responded") return "Response details unavailable";
    if (row.status === "Revoked") return "Revoked";
    return "No response";
  };

  const matrixAnswer = (
    row: AvailabilityProgressRow,
    item: (typeof occurrences)[number],
  ) => {
    if (row.status !== "Responded" || !row.hasResponseDetails) return "—";
    const answer = row.occurrenceAvailability[item.occurrenceId];
    if (answer === "available") return "Available";
    if (answer === "unavailable") return "Unavailable";
    return "No answer";
  };

  const answerTone = (answer: string | undefined) => {
    if (answer === "available") return "text-emerald-300";
    if (answer === "unavailable") return "text-rose-300";
    return "text-gray-300";
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Availability by date"
      description="Choose a service date to see each volunteer’s answer."
      size="xl"
      contentClassName="min-h-0 overflow-y-auto"
    >
      <div className="space-y-4 text-sm text-gray-200">
        {!occurrences.length ? (
          <p className="text-gray-400">This form has no service dates to compare.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Select
                label="Service date"
                size="sm"
                value={occurrence?.occurrenceId || ""}
                onChange={(value) => {
                  setOccurrenceId(value);
                  setPage(0);
                }}
                options={occurrences.map((item) => ({
                  value: item.occurrenceId,
                  label: `${dateLabel(item)} · ${item.name}`,
                }))}
              />
              <Select
                label="Team"
                size="sm"
                value={teamId}
                onChange={(value) => {
                  setTeamId(value);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "All teams" },
                  ...teamsForForm.map((team) => ({
                    value: team.teamId,
                    label: team.name,
                  })),
                ]}
              />
              <Select
                label="Availability"
                size="sm"
                value={category}
                onChange={(value) => {
                  setCategory(value as Category);
                  setPage(0);
                }}
                options={categoryOptions}
              />
            </div>

            {occurrence ? (
              <p className="text-xs text-gray-400">
                {dateLabel(occurrence)} · {occurrence.name}
              </p>
            ) : null}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-gray-700 py-3 xl:grid-cols-5">
              <div><dt className="text-xs text-gray-400">Available</dt><dd className="mt-1 font-semibold text-emerald-300">{counts.available}</dd></div>
              <div><dt className="text-xs text-gray-400">Unavailable</dt><dd className="mt-1 font-semibold text-rose-300">{counts.unavailable}</dd></div>
              <div><dt className="text-xs text-gray-400">Incomplete answer</dt><dd className="mt-1 font-semibold text-amber-200">{counts.incomplete}</dd></div>
              <div><dt className="text-xs text-gray-400">No response</dt><dd className="mt-1 font-semibold text-gray-200">{counts.noResponse}</dd></div>
              <div><dt className="text-xs text-gray-400">Response details unavailable</dt><dd className="mt-1 font-semibold text-gray-300">{counts.detailsUnavailable}</dd></div>
            </dl>

            <div className="max-h-[35vh] overflow-y-auto divide-y divide-gray-700" role="list" aria-label="Availability results">
              {pageRows.map((row) => {
                const answer = answerFor(row);
                return (
                  <div
                    key={row.member.memberId}
                    role="listitem"
                    aria-label={`${memberName(row.member)}: ${answerLabel(row)}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]"
                  >
                    <MemberNameWithIndicator
                      name={memberName(row.member)}
                      memberId={row.member.memberId}
                      className="font-medium text-white"
                    />
                    <span className={`flex items-center gap-1.5 text-right ${answerTone(answer)}`}>
                      {answer === "available" ? <Check aria-hidden="true" size={15} /> : null}
                      {answer === "unavailable" ? <X aria-hidden="true" size={15} /> : null}
                      {!answer ? <CircleMinus aria-hidden="true" size={15} /> : null}
                      {answerLabel(row)}
                    </span>
                  </div>
                );
              })}
              {!pageRows.length ? (
                <p className="py-5 text-gray-400">No volunteers match this view.</p>
              ) : null}
            </div>
            {pageCount > 1 ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">
                  Page {currentPage + 1} of {pageCount} · {visibleRows.length} volunteers
                </p>
                <div className="flex gap-2">
                  <Button variant="tertiary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                  <Button variant="tertiary" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
                </div>
              </div>
            ) : null}

            <details className="border-t border-gray-700 pt-3">
              <summary className="cursor-pointer text-sm text-gray-300">
                Show full response matrix
              </summary>
              <div className="mt-3 max-h-[45vh] overflow-auto">
                <table className="w-full min-w-max text-left text-sm" aria-label="Availability response matrix">
                  <thead className="sticky top-0 bg-gray-800 text-xs text-gray-300">
                    <tr>
                      <th scope="col" className="sticky left-0 z-10 min-w-40 bg-gray-800 px-3 py-2">Volunteer</th>
                      <th scope="col" className="min-w-32 px-3 py-2">Response</th>
                      {occurrences.map((item) => (
                        <th key={item.occurrenceId} scope="col" className="min-w-36 px-3 py-2">
                          <span className="block">{dateLabel(item)}</span>
                          <span className="font-normal text-gray-400">{item.name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {scopedRows.map((row) => (
                      <tr key={row.member.memberId}>
                        <th scope="row" className="sticky left-0 bg-gray-800 px-3 py-2 font-medium text-white">
                          <MemberNameWithIndicator name={memberName(row.member)} memberId={row.member.memberId} />
                        </th>
                        <td className="px-3 py-2 text-gray-300">{row.status}</td>
                        {occurrences.map((item) => (
                          <td key={item.occurrenceId} className="px-3 py-2 text-gray-300">
                            {matrixAnswer(row, item)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
};

export default AvailabilityDateComparison;
