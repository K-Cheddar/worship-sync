import { useEffect, useState, type ReactNode } from "react";
import { Pencil, X } from "lucide-react";
import ResourceFileIcon from "./ResourceFileIcon";
import { resolveResourceFileType } from "../utils/resourceFileType";
import Button from "./Button/Button";
import Input from "./Input/Input";
import { formatStorageBytes } from "./StorageUsage/storageUsageFormatting";

type SelectedUploadFileRowProps = {
  file: File;
  displayName: string;
  visualType: "image" | "video" | "file";
  editable: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  progress?: ReactNode;
  error?: string;
};

const SelectedUploadFileRow = ({
  file,
  displayName,
  visualType,
  editable,
  onRename,
  onRemove,
  progress,
  error,
}: SelectedUploadFileRowProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const visual = resolveResourceFileType({ fileName: file.name, mimeType: file.type, mediaType: visualType });
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.toUpperCase() || visual.label
    : visual.label;

  useEffect(() => {
    if (visualType !== "image" || typeof URL.createObjectURL !== "function") {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, visualType]);

  useEffect(() => {
    if (!editable) setIsEditing(false);
  }, [editable]);

  return (
    <div className="flex w-full items-center gap-3 rounded border border-gray-700 bg-gray-950/40 p-3 text-sm">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-800 text-gray-300" aria-hidden="true">
        {previewUrl ? <img src={previewUrl} alt="" className="size-full object-cover" /> : (
          <div className="flex flex-col items-center">
            <ResourceFileIcon visual={visual} compact />
            {visualType === "file" ? <span className="text-[9px] leading-none">{visual.label === "TXT" ? "TEXT" : visual.label}</span> : null}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {isEditing && editable ? (
          <Input
            aria-label={`Display name for ${file.name}`}
            value={displayName}
            onChange={(value) => onRename(String(value))}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setIsEditing(false);
              if (event.key === "Escape") setIsEditing(false);
            }}
            autoFocus
            inputClassName="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100"
          />
        ) : (
          <p className="truncate text-gray-100">{displayName}</p>
        )}
        {displayName !== file.name ? <p className="truncate text-xs text-gray-500">Source: {file.name}</p> : null}
        <p className="truncate text-xs text-gray-400">{extension} · {formatStorageBytes(file.size)}</p>
        {progress}
        {error ? <p className="mt-1 text-xs text-red-300" role="alert">{error}</p> : null}
      </div>
      {editable ? (
        <div className="flex shrink-0 items-center gap-1">
          {!isEditing ? <Button type="button" variant="tertiary" svg={Pencil} aria-label={`Edit name for ${file.name}`} onClick={() => setIsEditing(true)} /> : null}
          <Button type="button" variant="tertiary" svg={X} aria-label={`Remove ${file.name}`} onClick={onRemove} />
        </div>
      ) : null}
    </div>
  );
};

export default SelectedUploadFileRow;
