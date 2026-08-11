import Drawer from "../components/Drawer/Drawer";
import FloatingWindow from "../components/FloatingWindow/FloatingWindow";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useChat } from "./ChatContext";
import ChatWindow from "./ChatWindow";

const ChatWindowHost = () => {
  const chat = useChat();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  if (!chat?.available || !chat.isOpen) return null;

  if (!isDesktop) {
    return (
      <Drawer
        isOpen
        onClose={chat.closeChat}
        title="Team chat"
        position="right"
        size="full"
        contentPadding="p-0"
        contentClassName="flex min-h-0 flex-1 overflow-hidden"
      >
        <ChatWindow />
      </Drawer>
    );
  }

  return (
    <FloatingWindow
      title="Team chat"
      label="Team chat"
      onClose={chat.closeChat}
      defaultPosition={{
        x: Math.max(window.innerWidth - 420, 0),
        y: Math.max(window.innerHeight - 600, 0),
      }}
      defaultWidth={400}
      defaultHeight={560}
      contentClassName="p-0"
    >
      <ChatWindow />
    </FloatingWindow>
  );
};

export default ChatWindowHost;
