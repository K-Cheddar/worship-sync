import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamIntakePublic from "./TeamIntakePublic";
import { ToastProvider } from "../../context/toastContext";
import { getTeamIntakePreview, submitTeamIntake } from "../../api/auth";

jest.mock("../../api/auth", () => ({
  getTeamIntakePreview: jest.fn(),
  submitTeamIntake: jest.fn(),
}));

const mockGetPreview = jest.mocked(getTeamIntakePreview);
const mockSubmit = jest.mocked(submitTeamIntake);

const preview = {
  success: true,
  churchName: "Grace Chapel",
  form: {
    formId: "form_1",
    name: "Fall Volunteers",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    availabilityServices: [],
    availabilityOccurrences: [],
  },
  positions: [
    { positionId: "pos_1", teamId: "team_1", name: "Vocalist", icon: "mic" },
  ],
  teams: [{ teamId: "team_1", name: "Worship" }],
};

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/team-intake/tok_123"]}>
        <Routes>
          <Route path="/team-intake/:token" element={<TeamIntakePublic />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders the scoped form once the preview loads", async () => {
  mockGetPreview.mockResolvedValue(preview as never);
  renderPage();

  expect(await screen.findByText("Fall Volunteers")).toBeInTheDocument();
  // Only the position the server scoped into the preview is offered.
  expect(screen.getByText("Vocalist")).toBeInTheDocument();
  expect(mockGetPreview).toHaveBeenCalledWith("tok_123");
});

test("falls back to default wording when no custom messages are set", async () => {
  mockGetPreview.mockResolvedValue(preview as never);
  renderPage();
  await screen.findByText("Fall Volunteers");

  expect(
    screen.getByText(/share the positions you can serve in/i),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/check the positions you can serve in/i),
  ).toBeInTheDocument();
});

test("renders the form creator's custom wording when provided", async () => {
  mockGetPreview.mockResolvedValue({
    ...preview,
    form: {
      ...preview.form,
      welcomeMessage: "Welcome to Worship sign-ups!",
      positionsMessage: "In which positions would you like to serve?",
    },
  } as never);
  renderPage();
  await screen.findByText("Fall Volunteers");

  expect(
    screen.getByText("Welcome to Worship sign-ups!"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("In which positions would you like to serve?"),
  ).toBeInTheDocument();
  // The replaced default wording should no longer appear.
  expect(
    screen.queryByText(/check the positions you can serve in/i),
  ).not.toBeInTheDocument();
});

test("shows an error state when the preview cannot load", async () => {
  mockGetPreview.mockRejectedValue(new Error("This form is closed."));
  renderPage();

  expect(await screen.findByText("Form unavailable")).toBeInTheDocument();
  expect(screen.getByText("This form is closed.")).toBeInTheDocument();
});

test("blocks submission until a name is entered", async () => {
  mockGetPreview.mockResolvedValue(preview as never);
  mockSubmit.mockResolvedValue({ success: true, submissionId: "s1" });
  renderPage();
  await screen.findByText("Fall Volunteers");

  await userEvent.click(
    screen.getByRole("button", { name: /submit form/i }),
  );

  expect(mockSubmit).not.toHaveBeenCalled();
  expect(
    await screen.findByText(/first name.*last name.*email.*required/i),
  ).toBeInTheDocument();
});

test("submits the entered availability for the form token", async () => {
  mockGetPreview.mockResolvedValue(preview as never);
  mockSubmit.mockResolvedValue({ success: true, submissionId: "s1" });
  renderPage();
  await screen.findByText("Fall Volunteers");

  await userEvent.type(screen.getByLabelText(/first name/i), "Pat");
  await userEvent.type(screen.getByLabelText(/last name/i), "Reed");
  await userEvent.type(screen.getByLabelText(/email/i), "pat@example.com");
  await userEvent.click(
    screen.getByRole("button", { name: /submit form/i }),
  );

  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  expect(mockSubmit).toHaveBeenCalledWith(
    "tok_123",
    expect.objectContaining({ firstName: "Pat", lastName: "Reed" }),
  );
  expect(await screen.findByText(/thanks, pat/i)).toBeInTheDocument();
});

test("renders only the fields selected by the form owner", async () => {
  mockGetPreview.mockResolvedValue({
    ...preview,
    form: {
      ...preview.form,
      enabledFields: ["availability"],
      availabilityOccurrences: [
        {
          occurrenceId: "service_1@2026-09-06T10:00:00.000Z",
          serviceId: "service_1",
          name: "Sunday service",
          startsAt: "2026-09-06T10:00:00.000Z",
        },
      ],
    },
  } as never);
  mockSubmit.mockResolvedValue({ success: true, submissionId: "s1" });
  renderPage();
  await screen.findByText("Fall Volunteers");

  expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  expect(screen.getByText("Service date availability")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /submit form/i }));
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
});

test("shows the added profile and scheduling fields when selected", async () => {
  mockGetPreview.mockResolvedValue({
    ...preview,
    form: {
      ...preview.form,
      enabledFields: ["title", "birthDate", "schedulingPreferences"],
    },
  } as never);
  renderPage();
  await screen.findByText("Fall Volunteers");

  expect(screen.getByLabelText("Title:")).toBeInTheDocument();
  expect(screen.getByText(/Birthday/)).toBeInTheDocument();
  expect(screen.getByLabelText("Serving frequency:")).toBeInTheDocument();
  expect(screen.getByText("Weeks you can usually serve")).toBeInTheDocument();
});

test("requires every selected member-detail field before submitting", async () => {
  mockGetPreview.mockResolvedValue({
    ...preview,
    form: {
      ...preview.form,
      enabledFields: ["title", "firstName", "lastName", "email", "birthDate"],
    },
  } as never);
  renderPage();
  await screen.findByText("Fall Volunteers");

  expect(screen.getByLabelText("Title:")).toBeRequired();
  expect(screen.getByLabelText("First name:")).toBeRequired();
  expect(screen.getByLabelText("Last name:")).toBeRequired();
  expect(screen.getByLabelText("Email (required):")).toBeRequired();
  expect(screen.getByRole("combobox", { name: /Month/ })).toHaveAttribute(
    "aria-required",
    "true",
  );

  await userEvent.click(screen.getByRole("button", { name: /submit form/i }));

  expect(mockSubmit).not.toHaveBeenCalled();
  expect(
    await screen.findByText(
      "Title, First name, Last name, Birthday and Email are required.",
    ),
  ).toBeInTheDocument();
});

test("keeps a partial birthday while editing and validates it on submit", async () => {
  const user = userEvent.setup();
  mockGetPreview.mockResolvedValue({
    ...preview,
    form: {
      ...preview.form,
      enabledFields: ["firstName", "lastName", "birthDate"],
    },
  } as never);
  renderPage();
  await screen.findByText("Fall Volunteers");

  await user.type(screen.getByLabelText(/first name/i), "Pat");
  await user.type(screen.getByLabelText(/last name/i), "Reed");
  await user.click(screen.getByRole("combobox", { name: /month/i }));
  await user.click(await screen.findByRole("option", { name: "January" }));
  const day = screen.getByLabelText(/day/i);
  await user.type(day, "12");
  await user.clear(day);

  expect(screen.getByRole("combobox", { name: /month/i })).toHaveTextContent("January");

  await user.click(screen.getByRole("button", { name: /submit form/i }));

  expect(mockSubmit).not.toHaveBeenCalled();
  expect(
    await screen.findByText("Birthday needs a valid month and day."),
  ).toBeInTheDocument();
});
