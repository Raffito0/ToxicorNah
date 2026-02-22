import type { ChatMessage } from '../../types/contentScenario';

interface InstagramDMChatProps {
  contactName: string;
  messages: ChatMessage[];
}

export function InstagramDMChat({ contactName, messages }: InstagramDMChatProps) {
  return (
    <div
      style={{
        width: '390px',
        height: '844px',
        backgroundColor: '#000000',
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

      {/* Instagram DM Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px 14px',
          flexShrink: 0,
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Back arrow */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ marginRight: '12px', flexShrink: 0 }}>
          <path d="M15 19l-7-7 7-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Avatar */}
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #833AB4, #FD1D1D, #F77737)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: '12px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontSize: '15px', fontWeight: 600 }}>
              {contactName.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>

        {/* Name + status */}
        <div style={{ flex: 1 }}>
          <div style={{ color: '#fff', fontSize: '16px', fontWeight: 600, lineHeight: '1.2' }}>
            {contactName}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 400 }}>
            Active now
          </div>
        </div>

        {/* Right icons */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {/* Phone */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="#fff" strokeWidth="1.5" />
          </svg>
          {/* Video */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M23 7l-7 5 7 5V7z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            <rect x="1" y="5" width="15" height="14" rx="2" stroke="#fff" strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      {/* Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'hidden',
          padding: '16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
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
                <div
                  style={{
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: '12px',
                    fontWeight: 400,
                    padding: '12px 0 6px',
                  }}
                >
                  {msg.time}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-end',
                  gap: '8px',
                  marginTop: sameSenderAsPrev && !showTime ? '2px' : '8px',
                }}
              >
                {/* Their avatar on first message in group */}
                {!isMe && (!sameSenderAsPrev || showTime) && (
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #833AB4, #FD1D1D)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span style={{ color: '#fff', fontSize: '11px', fontWeight: 600 }}>
                        {contactName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
                {/* Spacer when avatar is hidden */}
                {!isMe && sameSenderAsPrev && !showTime && (
                  <div style={{ width: '28px', flexShrink: 0 }} />
                )}

                <div
                  style={{
                    maxWidth: '260px',
                    padding: '10px 16px',
                    borderRadius: isMe ? '22px 22px 4px 22px' : '22px 22px 22px 4px',
                    background: isMe
                      ? 'linear-gradient(135deg, #5B51D8, #833AB4)'
                      : '#262626',
                    color: '#fff',
                    fontSize: '15px',
                    lineHeight: '1.35',
                    fontWeight: 400,
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.text}
                </div>
              </div>
            </div>
          );
        })}

        {/* Seen indicator */}
        {messages.length > 0 && messages[messages.length - 1].sender === 'me' && (
          <div style={{ textAlign: 'right', paddingRight: '4px', paddingTop: '4px' }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 400 }}>
              Seen
            </span>
          </div>
        )}
      </div>

      {/* Instagram Input Bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px 34px',
          borderTop: '0.5px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        {/* Camera icon */}
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #405DE6, #833AB4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="5" width="20" height="15" rx="3" stroke="#fff" strokeWidth="1.5" />
            <circle cx="12" cy="12.5" r="4" stroke="#fff" strokeWidth="1.5" />
          </svg>
        </div>

        {/* Text input */}
        <div
          style={{
            flex: 1,
            height: '40px',
            borderRadius: '22px',
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
          }}
        >
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '15px', fontWeight: 400 }}>
            Message...
          </span>
        </div>

        {/* Mic icon */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="#fff" strokeWidth="1.5" />
          <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 19v4m-4 0h8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Home indicator */}
      <div style={{ height: '5px', display: 'flex', justifyContent: 'center', paddingBottom: '8px' }}>
        <div style={{ width: '134px', height: '5px', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.3)' }} />
      </div>
    </div>
  );
}
