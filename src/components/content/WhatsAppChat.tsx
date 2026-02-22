import type { ChatMessage } from '../../types/contentScenario';

interface WhatsAppChatProps {
  contactName: string;
  messages: ChatMessage[];
}

export function WhatsAppChat({ contactName, messages }: WhatsAppChatProps) {
  return (
    <div
      style={{
        width: '390px',
        height: '844px',
        backgroundColor: '#0B141A',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* iOS Status Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 24px 0',
          height: '54px',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#fff', fontSize: '16px', fontWeight: 600 }}>9:41</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
            <rect x="0" y="8" width="3" height="4" rx="0.5" fill="#fff" />
            <rect x="4" y="5.5" width="3" height="6.5" rx="0.5" fill="#fff" />
            <rect x="8" y="3" width="3" height="9" rx="0.5" fill="#fff" />
            <rect x="12" y="0" width="3" height="12" rx="0.5" fill="#fff" />
          </svg>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <path d="M4.5 8.5C5.5 7.2 6.7 6.5 8 6.5s2.5.7 3.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2 5.5C3.8 3.5 5.8 2.5 8 2.5s4.2 1 6 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
            <rect x="0.5" y="0.5" width="23" height="12" rx="3" stroke="#fff" strokeOpacity="0.35" />
            <rect x="2" y="2" width="17" height="9" rx="1.5" fill="#fff" />
            <rect x="25" y="4" width="2" height="5" rx="1" fill="#fff" fillOpacity="0.4" />
          </svg>
        </div>
      </div>

      {/* WhatsApp Header - dark green bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 12px 12px',
          flexShrink: 0,
          backgroundColor: '#1F2C34',
        }}
      >
        {/* Back arrow */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ marginRight: '4px', flexShrink: 0 }}>
          <path d="M15 19l-7-7 7-7" stroke="#00A884" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Avatar */}
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: '#2A3942',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: '12px',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" fill="#687882" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#687882" />
          </svg>
        </div>

        {/* Name + status */}
        <div style={{ flex: 1 }}>
          <div style={{ color: '#E9EDEF', fontSize: '17px', fontWeight: 500, lineHeight: '1.2' }}>
            {contactName}
          </div>
          <div style={{ color: 'rgba(233,237,239,0.5)', fontSize: '13px', fontWeight: 400 }}>
            online
          </div>
        </div>

        {/* Right icons */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {/* Video */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M23 7l-7 5 7 5V7z" stroke="#AEBAC1" strokeWidth="1.5" strokeLinejoin="round" />
            <rect x="1" y="5" width="15" height="14" rx="2" stroke="#AEBAC1" strokeWidth="1.5" />
          </svg>
          {/* Phone */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="#AEBAC1" strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      {/* Messages Area - with wallpaper pattern */}
      <div
        style={{
          flex: 1,
          overflowY: 'hidden',
          padding: '12px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Ccircle cx=\'10\' cy=\'10\' r=\'1\'/%3E%3Ccircle cx=\'40\' cy=\'30\' r=\'1\'/%3E%3Ccircle cx=\'20\' cy=\'50\' r=\'1\'/%3E%3C/g%3E%3C/svg%3E")',
        }}
      >
        {messages.map((msg, i) => {
          const isMe = msg.sender === 'me';
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const sameSenderAsPrev = prevMsg?.sender === msg.sender;
          const showTime = msg.time && (!prevMsg?.time || prevMsg.time !== msg.time);

          return (
            <div key={i}>
              {showTime && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
                  <span
                    style={{
                      backgroundColor: '#1D2831',
                      color: 'rgba(233,237,239,0.6)',
                      fontSize: '12px',
                      fontWeight: 400,
                      padding: '4px 12px',
                      borderRadius: '8px',
                    }}
                  >
                    {msg.time}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  marginTop: sameSenderAsPrev && !showTime ? '2px' : '6px',
                }}
              >
                <div
                  style={{
                    maxWidth: '280px',
                    padding: '7px 11px 7px 11px',
                    borderRadius: isMe ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                    backgroundColor: isMe ? '#005C4B' : '#1F2C34',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      color: '#E9EDEF',
                      fontSize: '15.5px',
                      lineHeight: '1.35',
                      fontWeight: 400,
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.text}
                  </span>
                  {/* Time + checkmarks inline */}
                  <span
                    style={{
                      float: 'right',
                      marginLeft: '8px',
                      marginTop: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span style={{ color: 'rgba(233,237,239,0.4)', fontSize: '11px', fontWeight: 400 }}>
                      {msg.time?.replace(/\s*(AM|PM)/i, (m) => m.toLowerCase()) || ''}
                    </span>
                    {isMe && (
                      <svg width="18" height="10" viewBox="0 0 18 10" fill="none">
                        <path d="M1 5.5l3 3 5.5-7" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M6 5.5l3 3 5.5-7" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* WhatsApp Input Bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '6px 8px 34px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#0B141A',
        }}
      >
        {/* Text input area */}
        <div
          style={{
            flex: 1,
            height: '42px',
            borderRadius: '24px',
            backgroundColor: '#1F2C34',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: '10px',
          }}
        >
          {/* Emoji */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke="#8696A0" strokeWidth="1.5" />
            <circle cx="9" cy="10" r="1" fill="#8696A0" />
            <circle cx="15" cy="10" r="1" fill="#8696A0" />
            <path d="M8 14c1 2 3 3 4 3s3-1 4-3" stroke="#8696A0" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span style={{ color: 'rgba(233,237,239,0.35)', fontSize: '16px', fontWeight: 400, flex: 1 }}>
            Message
          </span>
          {/* Attachment */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="#8696A0" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {/* Camera */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <rect x="2" y="6" width="20" height="14" rx="3" stroke="#8696A0" strokeWidth="1.5" />
            <circle cx="12" cy="13" r="4" stroke="#8696A0" strokeWidth="1.5" />
            <path d="M8 2l2 4h4l2-4" stroke="#8696A0" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>

        {/* Mic button */}
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            backgroundColor: '#00A884',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" fill="#fff" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 19v4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Home indicator */}
      <div style={{ height: '5px', display: 'flex', justifyContent: 'center', paddingBottom: '8px' }}>
        <div style={{ width: '134px', height: '5px', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.3)' }} />
      </div>
    </div>
  );
}
