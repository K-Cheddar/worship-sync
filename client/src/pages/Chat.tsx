import { MessageCircle } from "lucide-react";
import AppPageShell from "../components/AppPageShell/AppPageShell";
import ChatWindow from "../chat/ChatWindow";

const Chat = () => (
  <AppPageShell
    title="Team chat"
    icon={MessageCircle}
    description="Messages for your team"
  >
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-700 shadow-xl">
      <ChatWindow />
    </div>
  </AppPageShell>
);

export default Chat;
