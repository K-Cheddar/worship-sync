import { useState } from "react";
import Button from "../Button/Button";
import Modal from "../Modal/Modal";
import MemberAvatar from "../MemberAvatar/MemberAvatar";

type ProfileImagePreviewProps = {
  imageUrl: string;
  memberName: string;
  className?: string;
};

const ProfileImagePreview = ({
  imageUrl,
  memberName,
  className = "h-16 w-16",
}: ProfileImagePreviewProps) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="none"
        padding="p-0"
        className={`${className} shrink-0 overflow-hidden rounded-full focus-visible:ring-2 focus-visible:ring-cyan-400/70`}
        aria-label={`View profile image of ${memberName}`}
        onClick={() => setIsPreviewOpen(true)}
      >
        <MemberAvatar
          profileImageUrl={imageUrl}
          memberName={memberName}
          className="h-full w-full"
        />
      </Button>
      <Modal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={`${memberName} profile image`}
        size="fit"
        contentPadding="p-4"
        surfaceClassName="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] bg-gray-900"
      >
        <img
          src={imageUrl}
          alt={`${memberName} profile`}
          className="mx-auto block max-h-[calc(100vh-8rem)] max-w-[calc(100vw-2rem)] object-contain"
        />
      </Modal>
    </>
  );
};

export default ProfileImagePreview;
