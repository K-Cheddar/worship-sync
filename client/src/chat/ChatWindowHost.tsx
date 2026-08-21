import FloatingWindow from "../components/FloatingWindow/FloatingWindow";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useChat } from "./ChatContext";
import ChatWindow from "./ChatWindow";

const MARGIN = 12;

const chatWindowLayout = (isCompact: boolean) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (isCompact) {
    const width = Math.max(vw - MARGIN * 2, 280);
    const height = Math.max(vh - MARGIN * 2, 360);
    return {
      defaultWidth: width,
      defaultHeight: height,
      defaultPosition: { x: MARGIN, y: MARGIN },
    };
  }
  const width = Math.min(480, Math.max(vw - MARGIN * 2, 320));
  const height = Math.min(640, Math.max(vh - MARGIN * 2, 420));
  return {
    defaultWidth: width,
    defaultHeight: height,
    defaultPosition: {
      x: Math.max(vw - width - MARGIN, MARGIN),
      y: Math.max(vh - height - MARGIN, MARGIN),
    },
  };
};

const ChatWindowHost = () => {
  const chat = useChat();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  if (!chat?.available || !chat.isOpen) return null;

  const layout = chatWindowLayout(!isDesktop);

  return (
    <FloatingWindow
      title="Team chat"
      label="Team chat"
      onClose={chat.closeChat}
      defaultPosition={layout.defaultPosition}
      defaultWidth={layout.defaultWidth}
      defaultHeight={layout.defaultHeight}
      resizable
      contentClassName="overflow-hidden p-0"
    >
      <ChatWindow />
    </FloatingWindow>
  );
};

export default ChatWindowHost;
