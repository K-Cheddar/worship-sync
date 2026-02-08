import Drawer from "../../components/Drawer";
import OverlayPreview from "./OverlayPreview";
import { useState } from "react";
import {
  defaultImageOverlayStyles,
  defaultParticipantOverlayStyles,
  defaultQrCodeOverlayStyles,
  defaultStbOverlayStyles,
} from "../../components/DisplayWindow/defaultOverlayStyles";
import { OverlayInfo } from "../../types";
import { useDispatch, useSelector } from "../../hooks";
import Input from "../../components/Input/Input";
import Button from "../../components/Button/Button";
import { RootState } from "../../store/store";
import {
  addTemplate,
  deleteTemplate,
  updateTemplate,
} from "../../store/overlayTemplatesSlice";
import { OverlayFormatting, OverlayType, SavedTemplate } from "../../types";
import { Pencil } from "lucide-react";
import { Trash2 } from "lucide-react";
import { Check } from "lucide-react";
import { X } from "lucide-react";
import { Paintbrush } from "lucide-react";
import { Plus } from "lucide-react";
import generateRandomId from "../../utils/generateRandomId";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
  selectedOverlay: OverlayInfo;
  onApplyFormatting: (overlay: OverlayInfo) => void;
  onApplyFormattingToAll: (formatting: OverlayFormatting) => void | Promise<void>;
  isApplyingFormattingToAll: boolean;
};

const typeToName = {
  participant: "Participant",
  "stick-to-bottom": "Stick to Bottom",
  "qr-code": "QR Code",
  image: "Image",
};

const OverlayTemplatesDrawer = ({
  isOpen,
  onClose,
  isMobile,
  selectedOverlay,
  onApplyFormatting,
  onApplyFormattingToAll,
  isApplyingFormattingToAll,
}: Props) => {
  const dispatch = useDispatch();
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null
  );
  const [editingTemplateName, setEditingTemplateName] = useState("");

  const currentType: OverlayType =
    (selectedOverlay.type as OverlayType) || "participant";

  const currentTypeTemplates: SavedTemplate[] = useSelector(
    (state: RootState) =>
      state.undoable.present.overlayTemplates.templatesByType[currentType] || []
  );

  const handleCreateTemplateWithDefaultName = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const defaultName = `${typeToName[currentType as keyof typeof typeToName]} ${year}-${month}-${day}`;

    const newTemplate: SavedTemplate = {
      id: `${currentType}-${generateRandomId()}`,
      name: defaultName,
      formatting: selectedOverlay.formatting || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dispatch(addTemplate({ type: currentType, template: newTemplate }));
  };

  const handleDeleteTemplate = (id: string) => {
    dispatch(deleteTemplate({ type: currentType, templateId: id }));
  };

  const handleStartEdit = (template: SavedTemplate) => {
    setEditingTemplateId(template.id);
    setEditingTemplateName(template.name);
  };

  const handleSaveEdit = () => {
    if (!editingTemplateId || !editingTemplateName.trim()) return;

    dispatch(
      updateTemplate({
        type: currentType,
        templateId: editingTemplateId,
        updates: { name: editingTemplateName.trim() },
      })
    );

    setEditingTemplateId(null);
    setEditingTemplateName("");
  };

  const handleCancelEdit = () => {
    setEditingTemplateId(null);
    setEditingTemplateName("");
  };

  const handleUpdateTemplateStyles = (template: SavedTemplate) => {
    dispatch(
      updateTemplate({
        type: currentType,
        templateId: template.id,
        updates: {
          formatting: selectedOverlay.formatting || {},
          updatedAt: new Date().toISOString(),
        },
      })
    );
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      size={isMobile ? "lg" : "md"}
      position={isMobile ? "bottom" : "right"}
      title={`${typeToName[selectedOverlay.type as keyof typeof typeToName]} Templates`}
    >
      <Button
        variant="secondary"
        onClick={handleCreateTemplateWithDefaultName}
        svg={Plus}
        color="#22d3ee"
        className="mb-2 text-sm"
      >
        Create New Template
      </Button>
      {currentTypeTemplates.length > 0 && (
        <>
          <h4 className="text-sm font-semibold mb-2">Custom Templates</h4>
          <ul className="flex flex-col gap-2 w-full">
            {currentTypeTemplates.map((template) => (
              <li
                key={template.id}
                className="flex flex-col gap-2 border border-slate-200 rounded py-2 px-2"
              >
                <div className="flex items-center justify-between gap-2">
                  {editingTemplateId === template.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={editingTemplateName}
                        onChange={(val) => setEditingTemplateName(String(val))}
                        placeholder="Template name"
                        inputTextSize="text-sm"
                        className="flex-1"
                        hideLabel
                        data-ignore-undo="true"
                      />
                      <Button
                        className="text-xs px-2 py-1"
                        variant="tertiary"
                        onClick={handleSaveEdit}
                        disabled={!editingTemplateName.trim()}
                        svg={Check}
                        title="Save changes"
                        color="#84cc16"
                      />
                      <Button
                        className="text-xs px-2 py-1"
                        variant="tertiary"
                        onClick={handleCancelEdit}
                        svg={X}
                        title="Cancel editing"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-1">
                        <span
                          className="text-sm truncate cursor-pointer"
                          title={template.name}
                          onClick={() => handleStartEdit(template)}
                        >
                          {template.name}
                        </span>
                        <Button
                          className="text-xs px-1 py-1"
                          variant="tertiary"
                          onClick={() => handleStartEdit(template)}
                          svg={Pencil}
                          color="#eab308"
                          title="Edit template name"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          className="text-xs px-2 py-1"
                          variant="tertiary"
                          onClick={() => handleDeleteTemplate(template.id)}
                          svg={Trash2}
                          color="#dc2626"
                          title="Delete template"
                        />
                      </div>
                    </>
                  )}
                </div>
                <OverlayPreview
                  overlay={selectedOverlay}
                  defaultStyles={template.formatting}
                  onApply={() =>
                    onApplyFormatting({
                      ...selectedOverlay,
                      formatting: template.formatting,
                    })
                  }
                  onApplyToAll={() =>
                    onApplyFormattingToAll(template.formatting)
                  }
                  isApplyToAllLoading={isApplyingFormattingToAll}
                  secondaryAction={
                    <Button
                      className="justify-center flex-1 text-sm"
                      variant="secondary"
                      color="#22d3ee"
                      onClick={() => handleUpdateTemplateStyles(template)}
                      svg={Paintbrush}
                      title="Update template with current styles"
                    >
                      Update
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="px-4 pt-2 border-t-2 border-dashed border-slate-200 mt-4">
        <h4 className="text-sm font-semibold mb-2">Default Template</h4>
      </div>
      {selectedOverlay.type === "participant" && (
        <OverlayPreview
          overlay={selectedOverlay}
          defaultStyles={defaultParticipantOverlayStyles}
          onApply={() => {
            onApplyFormatting({
              ...selectedOverlay,
              formatting: defaultParticipantOverlayStyles,
            });
          }}
          onApplyToAll={() =>
            onApplyFormattingToAll(defaultParticipantOverlayStyles)
          }
          isApplyToAllLoading={isApplyingFormattingToAll}
        />
      )}
      {selectedOverlay.type === "stick-to-bottom" && (
        <OverlayPreview
          overlay={selectedOverlay}
          defaultStyles={defaultStbOverlayStyles}
          onApply={() => {
            onApplyFormatting({
              ...selectedOverlay,
              formatting: defaultStbOverlayStyles,
            });
          }}
          onApplyToAll={() =>
            onApplyFormattingToAll(defaultStbOverlayStyles)
          }
          isApplyToAllLoading={isApplyingFormattingToAll}
        />
      )}
      {selectedOverlay.type === "qr-code" && (
        <OverlayPreview
          overlay={selectedOverlay}
          defaultStyles={defaultQrCodeOverlayStyles}
          onApply={() => {
            onApplyFormatting({
              ...selectedOverlay,
              formatting: defaultQrCodeOverlayStyles,
            });
          }}
          onApplyToAll={() =>
            onApplyFormattingToAll(defaultQrCodeOverlayStyles)
          }
          isApplyToAllLoading={isApplyingFormattingToAll}
        />
      )}
      {selectedOverlay.type === "image" && (
        <OverlayPreview
          overlay={selectedOverlay}
          defaultStyles={defaultImageOverlayStyles}
          onApply={() => {
            onApplyFormatting({
              ...selectedOverlay,
              formatting: defaultImageOverlayStyles,
            });
          }}
          onApplyToAll={() =>
            onApplyFormattingToAll(defaultImageOverlayStyles)
          }
          isApplyToAllLoading={isApplyingFormattingToAll}
        />
      )}
    </Drawer>
  );
};

export default OverlayTemplatesDrawer;
