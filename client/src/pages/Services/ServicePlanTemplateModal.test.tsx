import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanTemplateModal from "./ServicePlanTemplateModal";
import { ToastProvider } from "../../context/toastContext";
import {
  deleteServicePlanTemplate,
  listServicePlanTemplates,
  saveServicePlanTemplate,
} from "../../api/auth";
import type { ServicePlanTemplate } from "../../types/servicePlan";
import type { ServicePlanTemplateResource } from "./servicePlanTemplateResource";

jest.mock("../../api/auth", () => ({
  deleteServicePlanTemplate: jest.fn(),
  listServicePlanTemplates: jest.fn(),
  saveServicePlanTemplate: jest.fn(),
}));

const mockDelete = jest.mocked(deleteServicePlanTemplate);
const mockList = jest.mocked(listServicePlanTemplates);
const mockSave = jest.mocked(saveServicePlanTemplate);

const existingTemplate: ServicePlanTemplate = {
  templateId: "template-1",
  churchId: "church-1",
  name: "Current template",
  sections: [],
  revision: 2,
};

const renderModal = (
  mode: "apply" | "save",
  templateResource?: ServicePlanTemplateResource,
) => render(
  <ToastProvider>
    <ServicePlanTemplateModal
      mode={mode}
      churchId="church-1"
      serviceId="service-1"
      serviceName="Sabbath Service"
      sections={[]}
      onClose={jest.fn()}
      onApply={jest.fn()}
      templateResource={templateResource}
    />
  </ToastProvider>,
);

describe("ServicePlanTemplateModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({ success: true, templates: [existingTemplate] });
    mockSave.mockResolvedValue({ success: true, template: existingTemplate });
    mockDelete.mockResolvedValue({ success: true });
  });

  it("uses the supplied catalog and does not list templates", async () => {
    const ensureLoaded = jest.fn();
    renderModal("apply", {
      data: [existingTemplate],
      loaded: true,
      loading: true,
      error: null,
      ensureLoaded,
    });

    expect(await screen.findByRole("button", { name: /Apply template Current template/i })).toBeInTheDocument();
    expect(screen.queryByText("Loading templates…")).not.toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
    expect(ensureLoaded).not.toHaveBeenCalled();
  });

  it("updates the shared catalog from authoritative create and overwrite responses", async () => {
    const user = userEvent.setup();
    const upsert = jest.fn();
    const resource = {
      data: [existingTemplate],
      loaded: true,
      loading: false,
      error: null,
      ensureLoaded: jest.fn(),
      upsert,
    } satisfies ServicePlanTemplateResource;
    const created = { ...existingTemplate, templateId: "template-2", name: "New" };
    mockSave.mockResolvedValueOnce({ success: true, template: created });
    const { rerender } = renderModal("save", resource);

    await user.type(screen.getByRole("textbox", { name: "Template name:" }), "New");
    await user.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(created));
    expect(mockList).not.toHaveBeenCalled();

    mockSave.mockResolvedValueOnce({
      success: true,
      template: { ...existingTemplate, name: "Overwritten", revision: 3 },
    });
    rerender(
      <ToastProvider>
        <ServicePlanTemplateModal
          mode="save"
          churchId="church-1"
          serviceId="service-1"
          serviceName="Sabbath Service"
          sections={[]}
          onClose={jest.fn()}
          onApply={jest.fn()}
          templateResource={resource}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Current template/i }));
    await user.click(screen.getByRole("button", { name: "Replace template" }));
    await waitFor(() => expect(upsert).toHaveBeenLastCalledWith({
      ...existingTemplate,
      name: "Overwritten",
      revision: 3,
    }));
  });

  it("removes a deleted template from the shared catalog", async () => {
    const user = userEvent.setup();
    const remove = jest.fn();
    renderModal("apply", {
      data: [existingTemplate],
      loaded: true,
      loading: false,
      error: null,
      ensureLoaded: jest.fn(),
      remove,
    });

    await user.click(await screen.findByRole("button", { name: "Delete template Current template" }));
    expect(remove).toHaveBeenCalledWith("template-1");
    expect(mockList).not.toHaveBeenCalled();
  });

  it("keeps standalone template fetching when no catalog is supplied", async () => {
    renderModal("apply");
    expect(await screen.findByRole("button", { name: /Apply template Current template/i })).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith("church-1");
  });
});
