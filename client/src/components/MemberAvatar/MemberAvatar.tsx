import { useState } from "react";
import { cn } from "@/utils/cnHelper";

type MemberAvatarProps = {
  profileImageUrl?: string | null;
  memberName: string;
  size?: "default" | "schedule";
  className?: string;
};

const getInitials = (memberName: string) => {
  const parts = memberName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0][0]}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
};

/** Decorative member identity visual; keep the adjacent name as its accessible label. */
const MemberAvatar = ({
  profileImageUrl,
  memberName,
  size = "default",
  className,
}: MemberAvatarProps) => {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showImage = Boolean(profileImageUrl && profileImageUrl !== failedImageUrl);
  const sizeClassName =
    size === "schedule"
      ? "size-[1.5rem] max-md:size-[1.75rem] text-[8px] max-md:text-[10px]"
      : "h-8 w-8";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-700 text-[10px] font-semibold text-gray-100",
        sizeClassName,
        className,
      )}
    >
      {showImage ? (
        <img
          src={profileImageUrl!}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailedImageUrl(profileImageUrl!)}
        />
      ) : (
        getInitials(memberName)
      )}
    </span>
  );
};

export default MemberAvatar;
