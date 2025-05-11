import { useLocation } from "react-router-dom";
import { ReactComponent as SettingsSVG } from "../../assets/icons/settings.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import { ReactComponent as UploadSVG } from "../../assets/icons/upload.svg";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import { useSelector } from "../../hooks";
import { forwardRef, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button/Button";

type sections = "outlines" | "slide-tools";

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const { isEditMode } = useSelector((state) => state.undoable.present.item);
    const { shouldShowItemEditor } = useSelector((state) => state.preferences);
    const [isUploading, setIsUploading] = useState(false);

    const [section, setSection] = useState<sections>("outlines");
    const onItemPage = useMemo(
      () => location.pathname.includes("controller/item"),
      [location.pathname]
    );

    const handleFileUpload = async (
      event: React.ChangeEvent<HTMLInputElement>
    ) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_BASE_PATH}process-program-outline`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.details || errorData.error || "Failed to process file"
          );
        }

        const data = await response.json();
        console.log("Participants:", data.participants);
        // TODO: Handle the participants data as needed
      } catch (error) {
        console.error("Error uploading file:", error);
        alert(
          error instanceof Error ? error.message : "Failed to process file"
        );
      } finally {
        setIsUploading(false);
        // Reset the file input
        event.target.value = "";
      }
    };

    useEffect(() => {
      if (onItemPage && shouldShowItemEditor) {
        setSection("slide-tools");
      } else {
        setSection("outlines");
      }
    }, [onItemPage, shouldShowItemEditor]);

    return (
      <div ref={ref} className={className}>
        <div className="px-2 py-1 flex gap-1 flex-1 border-r-2 border-gray-500 items-center">
          <Menu />
          {!isEditMode && <Undo />}
        </div>
        <div className="w-full flex h-[3.75rem] min-h-fit flex-col">
          <div className="flex gap-1 border-b-2 border-gray-500">
            <Button
              variant="none"
              svg={SettingsSVG}
              onClick={() => setSection("outlines")}
              className={`text-xs rounded-none ${
                section === "outlines" && "bg-gray-800"
              }`}
            >
              Settings
            </Button>
            <Button
              variant="none"
              disabled={!onItemPage || !shouldShowItemEditor}
              svg={EditSquareSVG}
              onClick={() => setSection("slide-tools")}
              className={`text-xs rounded-none ${
                section === "slide-tools" && "bg-gray-800"
              }`}
            >
              Slide Tools
            </Button>
          </div>

          <div
            className={`px-2 py-1 flex gap-1 items-center flex-1 ${
              isEditMode ? "hidden" : ""
            }`}
          >
            <Outlines className={`${section !== "outlines" && "hidden"}`} />
            {section === "outlines" && (
              <div className="relative">
                <input
                  type="file"
                  accept=".docx"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="docx-upload"
                  disabled={isUploading}
                />
                <Button
                  variant="secondary"
                  svg={UploadSVG}
                  onClick={() =>
                    document.getElementById("docx-upload")?.click()
                  }
                  className="text-xs"
                  disabled={isUploading}
                >
                  {isUploading ? "Uploading..." : "Upload Schedule"}
                </Button>
              </div>
            )}
            <SlideEditTools
              className={`${
                (section !== "slide-tools" || !shouldShowItemEditor) && "hidden"
              }`}
            />
          </div>
        </div>
        <div className="px-2 py-1 flex gap-1 items-center flex-1 border-l-2 border-gray-500">
          <UserSection />
        </div>
      </div>
    );
  }
);

export default Toolbar;
