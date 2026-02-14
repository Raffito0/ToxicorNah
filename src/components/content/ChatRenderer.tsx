import type { ChatMessage } from '../../types/contentScenario';
import { IMessageChat } from './IMessageChat';
import { InstagramDMChat } from './InstagramDMChat';
import { WhatsAppChat } from './WhatsAppChat';

interface ChatRendererProps {
  appStyle: 'imessage' | 'instagram' | 'whatsapp';
  contactName: string;
  messages: ChatMessage[];
}

export function ChatRenderer({ appStyle, contactName, messages }: ChatRendererProps) {
  switch (appStyle) {
    case 'imessage':
      return <IMessageChat contactName={contactName} messages={messages} />;
    case 'instagram':
      return <InstagramDMChat contactName={contactName} messages={messages} />;
    case 'whatsapp':
      return <WhatsAppChat contactName={contactName} messages={messages} />;
    default:
      return <IMessageChat contactName={contactName} messages={messages} />;
  }
}
