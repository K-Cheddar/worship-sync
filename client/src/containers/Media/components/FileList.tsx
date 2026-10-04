import { useState } from "react";
import { Image, Pencil, Video, X } from "lucide-react";
import { FileUploadProgress } from "../MediaUploadInput.types";
import { TransferProgress } from "../../../components/TransferProgress/TransferProgress";

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
              {isUploading ? (
                <TransferProgress
                  transfer={{
                    id: `media-file-${index}`,
                    type: fileProgress.fileType === "video" ? "Video upload" : "Image upload",
                    name: fileProgress.displayName,
                    status: fileProgress.status === "error" ? "failed" : fileProgress.status === "ready" ? "complete" : "active",
                    progress: fileProgress.status === "uploading" || fileProgress.status === "processing" ? fileProgress.progress : null,
                    phase: { key: fileProgress.status, label: fileProgress.status === "processing" ? "Processing" : fileProgress.status === "error" ? "Upload failed" : fileProgress.status === "ready" ? "Complete" : "Uploading" },
                    detail: `${(fileProgress.file.size / 1024 / 1024).toFixed(2)} MB`,
                    ...(fileProgress.error ? { error: { message: fileProgress.error } } : {}),
                  }}
                  variant="summary"
                />
              ) : (
                <div className="text-xs text-gray-500">{(fileProgress.file.size / 1024 / 1024).toFixed(2)} MB</div>
              )}
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
