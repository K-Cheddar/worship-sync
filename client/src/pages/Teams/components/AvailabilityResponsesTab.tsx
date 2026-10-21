import { useState } from "react";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import type { TeamIntakeForm } from "../../../api/authTypes";
import type { AvailabilityProgressRow } from "../availabilityFormProgress";
import {
  formatPlainDateRangeLabel,
  formatShortOccurrenceDate,
  memberName,
} from "../teamsUtils";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";
import { parsePlainDate } from "../../../utils/plainDate";

const answerLabel = (value: string | undefined) => {
  if (value === "available") return "Available";
  if (value === "unavailable") return "Unavailable";
  return "No answer";
};

const AvailabilityResponsesTab = ({
  rows,
  form,
  serviceTimeZone,
}: {
  rows: AvailabilityProgressRow[];
  form: TeamIntakeForm;
  serviceTimeZone: string;
}) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const occurrences = form.availabilityOccurrences || [];
  const responded = rows.filter((row) => row.responded).length;
  const visible = rows.filter(
    (row) =>
      memberName(row.member)
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (filter !== "unanswered" || !row.responded) &&
      (filter !== "incomplete" ||
        occurrences.some(
          (occurrence) => !row.occurrenceAvailability[occurrence.occurrenceId],
        )),
  );
  const dateLabel = (occurrence: (typeof occurrences)[number]) => {
    if (occurrence.serviceDate)
      return formatPlainDateRangeLabel(
        occurrence.serviceDate,
        occurrence.serviceDate,
      );
    if (serviceTimeZone)
      return formatShortOccurrenceDate(occurrence.startsAt, serviceTimeZone);
    return "Date unavailable";
  };
  const responseStatus = (row: AvailabilityProgressRow) =>
    row.responded ? "Responded" : "No response";
  const mobileDateLabel = (occurrence: (typeof occurrences)[number]) => {
    const date = occurrence.serviceDate
      ? parsePlainDate(occurrence.serviceDate)
      : undefined;
    return date
      ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : dateLabel(occurrence);
  };
  return (
    <section className="space-y-4" aria-label="Availability responses">
      <p className="text-sm text-gray-300">
        {responded} of {rows.length} responded · {rows.length - responded}{" "}
        awaiting responses
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Search responses"
          value={search}
          onChange={(value) => setSearch(String(value))}
          placeholder="Search by member"
        />
        <Select
          label="Response status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "", label: "All volunteers" },
            { value: "unanswered", label: "Unanswered" },
            { value: "incomplete", label: "Incomplete responses" },
          ]}
        />
      </div>
      {!responded ? (
        <p className="text-sm text-gray-400">
          No responses received yet. Volunteers’ answers will appear here after
          they submit.
        </p>
      ) : null}
      {!visible.length ? (
        <p className="text-sm text-gray-400">
          No volunteers match these filters.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table
              className="w-full text-left text-sm"
              aria-label="Availability response matrix"
            >
              <thead className="border-b border-gray-700 text-gray-300">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 min-w-40 bg-gray-900 px-3 py-3"
                  >
                    Volunteer
                  </th>
                  <th scope="col" className="min-w-32 px-3 py-3">
                    Response
                  </th>
                  {occurrences.map((occurrence) => (
                    <th
                      key={occurrence.occurrenceId}
                      scope="col"
                      className="min-w-36 px-3 py-3"
                    >
                      <span className="block">{dateLabel(occurrence)}</span>
                      <span className="font-normal text-gray-400">
                        {occurrence.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {visible.map((row) => (
                  <tr key={row.member.memberId}>
                    <th
                      scope="row"
                      className="sticky left-0 bg-gray-900 px-3 py-3 font-medium text-white"
                    >
                      <MemberNameWithIndicator
                        name={memberName(row.member)}
                        memberId={row.member.memberId}
                      />
                    </th>
                    <td className="px-3 py-3 text-gray-300">
                      {responseStatus(row)}
                    </td>
                    {occurrences.map((occurrence) => (
                      <td
                        key={occurrence.occurrenceId}
                        className="px-3 py-3 text-gray-300"
                      >
                        {answerLabel(
                          row.occurrenceAvailability[occurrence.occurrenceId],
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="divide-y divide-gray-800 sm:hidden"
            aria-label="Volunteer responses"
          >
            {visible.map((row) => (
              <details key={row.member.memberId} className="py-3">
                <summary className="cursor-pointer text-sm text-white">
                  <MemberNameWithIndicator
                    name={memberName(row.member)}
                    memberId={row.member.memberId}
                  />{" "}
                  <span className="text-gray-400">— {responseStatus(row)}</span>
                </summary>
                <dl className="mt-3 space-y-3 pl-4 text-sm">
                  {occurrences.map((occurrence) => (
                    <div
                      key={occurrence.occurrenceId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
                    >
                      <dt className="text-gray-300">
                        {mobileDateLabel(occurrence)}
                        <span className="block text-xs text-gray-400">
                          {occurrence.name}
                        </span>
                      </dt>
                      <dd className="text-gray-200">
                        {answerLabel(
                          row.occurrenceAvailability[occurrence.occurrenceId],
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

export default AvailabilityResponsesTab;
