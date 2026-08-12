import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  ScheduleAssignmentProvider,
  type ScheduleAssignmentHandlers,
} from "./ScheduleAssignmentContext";
import ScheduleGridCell from "./ScheduleGridCell";

const baseProps = {
  occurrenceId: "occ-1",
  occurrenceName: "Sunday Service",
  occurrenceDate: "2026-08-16",
  columnKey: "cam::1",
  positionId: "cam",
  columnLabel: "Camera 2",
  rowTone: "bg-gray-950/80",
  axisHighlightClassName: "",
  isMemberHighlighted: false,
  isActiveSlot: false,
  allMembers: [],
  duplicateFirstNames: new Set<string>(),
  canEdit: true,
};

const renderCell = (
  props: Partial<ComponentProps<typeof ScheduleGridCell>> = {},
  handlers: Partial<ScheduleAssignmentHandlers> = {},
) => {
  const requestRemoveAdditionalPosition = jest.fn();
  render(
    <ScheduleAssignmentProvider
      handlers={
        {
          requestRemoveAdditionalPosition,
          ...handlers,
        } as ScheduleAssignmentHandlers
      }
    >
      <table>
        <tbody>
          <tr>
            <ScheduleGridCell
              {...baseProps}
              isSlotEnabled
              isAdditionalPosition
              {...props}
            />
          </tr>
        </tbody>
      </table>
    </ScheduleAssignmentProvider>,
  );
  return { requestRemoveAdditionalPosition };
};

describe("ScheduleGridCell", () => {
  it("shows a dash when the slot is not enabled for that date", () => {
    renderCell({ isSlotEnabled: false, isAdditionalPosition: false });
    expect(
      screen.getByLabelText("Camera 2 not needed for this service"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Remove Camera 2 from this date/i }),
    ).not.toBeInTheDocument();
  });

  it("shows remove for an added optional position and requests removal", () => {
    const { requestRemoveAdditionalPosition } = renderCell({
      isSlotEnabled: true,
      isAdditionalPosition: true,
    });

    const remove = screen.getByRole("button", {
      name: "Remove Camera 2 from this date",
    });
    fireEvent.click(remove);

    expect(requestRemoveAdditionalPosition).toHaveBeenCalledWith({
      serviceId: "occ-1",
      cellKey: "cam::1",
    });
  });

  it("does not show remove for a required position slot", () => {
    renderCell({ isSlotEnabled: true, isAdditionalPosition: false });

    expect(
      within(screen.getByRole("row")).queryByRole("button", {
        name: /Remove Camera 2 from this date/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sunday Service Camera 2, Empty/i }),
    ).toBeInTheDocument();
  });

  it("labels a schedule-only guest without treating the slot as empty", () => {
    renderCell({
      assignmentCell: { primaryMemberId: "scheduleGuest_1" },
      allMembers: [
        {
          memberId: "scheduleGuest_1",
          churchId: "church-1",
          firstName: "Alex Rivera",
          lastName: "",
          positionIds: [],
          blockoutDates: [],
          scheduleGuest: true,
        },
      ],
      isAdditionalPosition: false,
    });

    expect(
      screen.getByRole("button", {
        name: "Sunday Service Camera 2, Alex Rivera",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Guest")).toHaveTextContent("G");
  });
});
