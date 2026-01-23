import { Image, Video, X } from "lucide-react";
import { FileUploadProgress } from "../MediaUploadInput.types";

type FileListProps = {
  files: FileUploadProgress[];
  isUploading: boolean;
  onRemoveFile: (index: number) => void;
};

export const FileList = ({ files, isUploading, onRemoveFile }: FileListProps) => {
  if (files.length === 0) {
    return (
      <div className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded flex items-center justify-center text-sm">
        <span className="text-gray-500">No files selected</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2 max-h-48 overflow-y-auto">
      {files.map((fileProgress, index) => (
        <div
          key={index}
          className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded flex items-center justify-between gap-2 text-sm"
        >
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {fileProgress.fileType === "video" ? (
              <Video size={16} className="text-blue-400 shrink-0" />
            ) : (
              <Image size={16} className="text-green-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-gray-300 truncate">
                {fileProgress.file.name}
              </div>
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
            <button
              onClick={() => onRemoveFile(index)}
              className="text-gray-400 hover:text-red-500 transition-colors"
              type="button"
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
