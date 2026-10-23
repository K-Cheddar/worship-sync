import { AudioLines, File, FileImage, FileSpreadsheet, FileText, FileType2, FileVideo, Link2, Presentation } from "lucide-react";
import type { ResourceFileType, ResourceFileVisual } from "../utils/resourceFileType";

const visuals = {
  pdf: { Icon: FileText, color: "text-red-300" },
  word: { Icon: FileType2, color: "text-blue-300" },
  spreadsheet: { Icon: FileSpreadsheet, color: "text-green-300" },
  presentation: { Icon: Presentation, color: "text-orange-300" },
  image: { Icon: FileImage, color: "text-purple-300" },
  audio: { Icon: AudioLines, color: "text-amber-300" },
  video: { Icon: FileVideo, color: "text-pink-300" },
  link: { Icon: Link2, color: "text-cyan-300" },
  text: { Icon: FileText, color: "text-teal-300" },
  file: { Icon: File, color: "text-gray-300" },
} satisfies Record<ResourceFileType, { Icon: typeof File; color: string }>;

const ResourceFileIcon = ({ visual, compact = false }: { visual: ResourceFileVisual; compact?: boolean }) => {
  const { Icon, color } = visuals[visual.type];
  return <span aria-hidden="true" data-file-type={visual.type} className={`inline-flex shrink-0 items-center justify-center ${color} ${compact ? "size-7" : "size-[44px]"}`}><Icon className={compact ? "size-4" : "size-5"} /></span>;
};
export default ResourceFileIcon;
