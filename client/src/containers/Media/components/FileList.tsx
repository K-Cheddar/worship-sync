import { useState } from "react";
import { Image, Pencil, Video, X } from "lucide-react";
import { FileUploadProgress } from "../MediaUploadInput.types";

type FileListProps = {
  files: FileUploadProgress[];
  isUploading: boolean;
  onRemoveFile: (index: number) => void;
  onDisplayNameChange: (index: number, displayName: string) => void;
};

export const FileList = ({
  files,
  isUploading,
  onRemoveFile,
  onDisplayNameChange,
}: FileListProps) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  if (files.length === 0) {
    return (
      <div className="flex w-full items-center justify-center rounded border border-gray-600 bg-black/30 px-4 py-2 text-sm">
        <span className="text-gray-500">No files selected</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2 max-h-48 overflow-y-auto">
      {files.map((fileProgress, index) => (
        <div
          key={index}
          className="flex w-full items-center justify-between gap-2 rounded border border-gray-600 bg-black/30 px-4 py-2 text-sm"
        >
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {fileProgress.fileType === "video" ? (
              <Video size={16} className="text-blue-400 shrink-0" />
            ) : (
              <Image size={16} className="text-green-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              {editingIndex === index && !isUploading ? (
                <input
                  aria-label={`Display name for ${fileProgress.file.name}`}
                  value={fileProgress.displayName}
                  onChange={(event) =>
                    onDisplayNameChange(index, event.target.value)
                  }
                  onBlur={() => setEditingIndex(null)}
                  autoFocus
                  className="w-full rounded border border-gray-500 bg-gray-900 px-1 text-gray-100 outline-none focus:border-blue-400"
                />
              ) : (
                <div className="text-gray-300 truncate">
                  {fileProgress.displayName}
                </div>
              )}
              {fileProgress.displayName !== fileProgress.file.name && (
                <div className="truncate text-xs text-gray-500">
                  Source: {fileProgress.file.name}
                </div>
              )}
              <div className="text-xs text-gray-500">
                {(fileProgress.file.size / 1024 / 1024).toFixed(2)} MB
                {fileProgress.status === "uploading" && (
                  <span className="ml-2">
                    - {Math.round(fileProgress.progress)}%
                  </span>
                )}
                {fileProgress.status === "processing" && (
                  <span className="ml-2">- Processing...</span>
                )}
                {fileProgress.status === "ready" && (
                  <span className="ml-2 text-green-500">- Complete</span>
                )}
                {fileProgress.status === "error" && (
                  <span className="ml-2 text-red-500">
                    - {fileProgress.error || "Failed"}
                  </span>
                )}
              </div>
            </div>
          </div>
          {!isUploading && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setEditingIndex(index)}
                className="text-gray-400 hover:text-white transition-colors"
                type="button"
                aria-label={`Edit display name for ${fileProgress.file.name}`}
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => onRemoveFile(index)}
                className="text-gray-400 hover:text-red-500 transition-colors"
                type="button"
                aria-label={`Remove ${fileProgress.file.name}`}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
