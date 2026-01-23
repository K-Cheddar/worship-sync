
type UploadStatusDisplayProps = {
  uploadStatus: string;
  statusMessage: string;
  overallProgress: number;
  currentFileIndex: number;
  totalFiles: number;
};

export const UploadStatusDisplay = ({
  uploadStatus,
  statusMessage,
  overallProgress,
  currentFileIndex,
  totalFiles,
}: UploadStatusDisplayProps) => {
  if (uploadStatus === "idle") return null;

  return (
    <div className="bg-gray-900 p-3 rounded">
      <p className="text-sm text-gray-300 mb-2">{statusMessage}</p>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${overallProgress}%` }}
        />
      </div>
      {totalFiles > 1 && (
        <p className="text-xs text-gray-400 mt-2">
          Overall progress: {Math.round(overallProgress)}% (
          {currentFileIndex + 1}/{totalFiles} {totalFiles === 1 ? 'file' : 'files'})
        </p>
      )}
    </div>
  );
};
