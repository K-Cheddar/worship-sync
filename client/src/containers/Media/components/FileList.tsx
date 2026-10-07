import { TransferProgress } from "../../../components/TransferProgress/TransferProgress";
import SelectedUploadFileRow from "../../../components/SelectedUploadFileRow";
import { formatStorageBytes } from "../../../components/StorageUsage/storageUsageFormatting";
import type { FileUploadProgress } from "../MediaUploadInput.types";

type FileListProps = {
  files: FileUploadProgress[];
  isUploading: boolean;
  onRemoveFile: (index: number) => void;
  onDisplayNameChange: (index: number, displayName: string) => void;
};

export const FileList = ({ files, isUploading, onRemoveFile, onDisplayNameChange }: FileListProps) => {
  if (files.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Selected media files"
      tabIndex={0}
      className="flex min-h-0 max-h-[min(50vh,32rem)] w-full flex-1 flex-col gap-2 overflow-y-auto scrollbar-variable"
    >
      {files.map((fileProgress, index) => (
        <SelectedUploadFileRow
          key={`${fileProgress.file.name}-${index}`}
          file={fileProgress.file}
          displayName={fileProgress.displayName}
          visualType={fileProgress.fileType}
          editable={!isUploading}
          onRename={(name) => onDisplayNameChange(index, name)}
          onRemove={() => onRemoveFile(index)}
          progress={isUploading ? (
            <TransferProgress
              transfer={{
                id: `media-file-${index}`,
                type: fileProgress.fileType === "video" ? "Video upload" : "Image upload",
                name: fileProgress.displayName,
                status: fileProgress.status === "error" ? "failed" : fileProgress.status === "ready" ? "complete" : "active",
                progress: fileProgress.status === "uploading" || fileProgress.status === "processing" ? fileProgress.progress : null,
                phase: { key: fileProgress.status, label: fileProgress.status === "processing" ? "Processing" : fileProgress.status === "error" ? "Upload failed" : fileProgress.status === "ready" ? "Complete" : "Uploading" },
                detail: formatStorageBytes(fileProgress.file.size),
                ...(fileProgress.error ? { error: { message: fileProgress.error } } : {}),
              }}
              variant="summary"
            />
          ) : null}
          error={!isUploading ? fileProgress.error : undefined}
        />
      ))}
    </div>
  );
};
