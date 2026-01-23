import { Maximize2, Minus } from "lucide-react";
import { UploadStatus } from "../MediaUploadInput.types";
import Button from "../../../components/Button/Button";

type ProgressPopupProps = {
  uploadStatus: UploadStatus;
  overallProgress: number;
  statusMessage: string;
  currentFileIndex: number;
  totalFiles: number;
  onRestore: () => void;
  onMinimize: () => void;
};

export const ProgressPopup = ({
  uploadStatus,
  overallProgress,
  statusMessage,
  currentFileIndex,
  totalFiles,
  onRestore,
  onMinimize,
}: ProgressPopupProps) => {
  return (
    <div
      className="fixed bottom-10 right-4 z-10 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl min-w-[320px] max-w-[400px] cursor-pointer hover:border-gray-500 transition-colors"
      onClick={onRestore}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            Upload Progress{" "}
            <span className="text-gray-400 font-normal">
              {Math.round(uploadStatus === "ready" ? 100 : overallProgress)}%
            </span>
          </h3>
          <div className="flex items-center gap-2">

            <Button
              variant="tertiary"
              onClick={(e) => {
                e.stopPropagation();
                onRestore();
              }}
              title="Restore modal"
              svg={Maximize2}
            />
            <Button
              variant="tertiary"
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              title="Minimize to Add button"
              svg={Minus}
            />
          </div>
        </div>
        <p className="text-xs text-gray-300 mb-2 truncate">{statusMessage}</p>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              uploadStatus === "error"
                ? "bg-red-600"
                : uploadStatus === "ready"
                ? "bg-green-600"
                : "bg-blue-600"
            }`}
            style={{ width: `${uploadStatus === "ready" ? 100 : overallProgress}%` }}
          />
        </div>
        {totalFiles > 1 && (
          <p className="text-xs text-gray-400 mt-2">
            {uploadStatus === "ready" || uploadStatus === "error"
              ? `${totalFiles} files`
              : `${currentFileIndex + 1}/${totalFiles} files`}
          </p>
        )}
      </div>
    </div>
  );
};
