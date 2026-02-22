import type { ChatMessage } from '../../types/contentScenario';

interface IMessageChatProps {
  contactName: string;
  messages: ChatMessage[];
}

export function IMessageChat({ contactName, messages }: IMessageChatProps) {
  return (
    <div
      style={{
        width: '390px',
        height: '844px',
        backgroundColor: '#000000',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
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
        {/* Time */}
        <span style={{ color: '#fff', fontSize: '16px', fontWeight: 600, letterSpacing: '0.5px' }}>
          9:41
        </span>
        {/* Right icons: signal, wifi, battery */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Cellular */}
          <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
            <rect x="0" y="8" width="3" height="4" rx="0.5" fill="#fff" />
            <rect x="4" y="5.5" width="3" height="6.5" rx="0.5" fill="#fff" />
            <rect x="8" y="3" width="3" height="9" rx="0.5" fill="#fff" />
            <rect x="12" y="0" width="3" height="12" rx="0.5" fill="#fff" />
          </svg>
          {/* WiFi */}
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <path d="M8 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" fill="#fff" />
            <path d="M4.5 8.5C5.5 7.2 6.7 6.5 8 6.5s2.5.7 3.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2 5.5C3.8 3.5 5.8 2.5 8 2.5s4.2 1 6 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M0 2.5C2.5 0 5 -0.5 8 -0.5s5.5.5 8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          </svg>
          {/* Battery */}
          <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
            <rect x="0.5" y="0.5" width="23" height="12" rx="3" stroke="#fff" strokeOpacity="0.35" />
            <rect x="2" y="2" width="17" height="9" rx="1.5" fill="#fff" />
            <rect x="25" y="4" width="2" height="5" rx="1" fill="#fff" fillOpacity="0.4" />
          </svg>
        </div>
      </div>

      {/* Chat Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px 12px',
          flexShrink: 0,
          borderBottom: '0.5px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Back arrow */}
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" style={{ marginRight: '4px' }}>
          <path d="M10 2L2 10L10 18" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ color: '#007AFF', fontSize: '17px', marginRight: 'auto' }}>
          &nbsp;
        </span>

        {/* Contact info centered */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
          {/* Avatar circle */}
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6e6e73, #8e8e93)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '4px',
            }}
          >
            <span style={{ color: '#fff', fontSize: '18px', fontWeight: 500 }}>
              {contactName.charAt(0).toUpperCase()}
            </span>
          </div>
          <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>
            {contactName}
          </span>
        </div>

        {/* Right side icons */}
        <div style={{ display: 'flex', gap: '16px', marginLeft: 'auto' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M15.5 2.5c-1.5 0-3 1-4.5 3-1.5-2-3-3-4.5-3C3.5 2.5 1 5 1 8c0 5 10 12 10 12s10-7 10-12c0-3-2.5-5.5-5.5-5.5z" stroke="#007AFF" strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      {/* Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'hidden',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        {messages.map((msg, i) => {
          const isMe = msg.sender === 'me';
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const nextMsg = i < messages.length - 1 ? messages[i + 1] : null;
          const sameSenderAsPrev = prevMsg?.sender === msg.sender;
          const sameSenderAsNext = nextMsg?.sender === msg.sender;

          // Show time label when there's a time change
          const showTime = msg.time && (!prevMsg?.time || prevMsg.time !== msg.time);

          return (
            <div key={i}>
              {showTime && (
                <div
                  style={{
                    textAlign: 'center',
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: '11px',
                    fontWeight: 400,
                    padding: '8px 0 4px',
                  }}
                >
                  {msg.time}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  marginTop: sameSenderAsPrev && !showTime ? '2px' : '8px',
                }}
              >
                <div
                  style={{
                    maxWidth: '270px',
                    padding: '9px 14px',
                    borderRadius: isMe
                      ? sameSenderAsPrev && !showTime
                        ? '18px 18px 6px 18px'
                        : sameSenderAsNext
                          ? '18px 18px 6px 18px'
                          : '18px 18px 6px 18px'
                      : sameSenderAsPrev && !showTime
                        ? '18px 18px 18px 6px'
                        : sameSenderAsNext
                          ? '18px 18px 18px 6px'
                          : '18px 18px 18px 6px',
                    backgroundColor: isMe ? '#007AFF' : '#1C1C1E',
                    color: '#fff',
                    fontSize: '17px',
                    lineHeight: '1.35',
                    fontWeight: 400,
                    letterSpacing: '-0.2px',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.text}
                </div>
              </div>
            </div>
          );
        })}

        {/* Delivered indicator under last sent message */}
        {messages.length > 0 && messages[messages.length - 1].sender === 'me' && (
          <div style={{ textAlign: 'right', paddingRight: '4px', paddingTop: '2px' }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 400 }}>
              Delivered
            </span>
          </div>
        )}
      </div>

      {/* iMessage Input Bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 12px 34px',
          borderTop: '0.5px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {/* Plus button */}
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12M4 10h12" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {/* Text input */}
        <div
          style={{
            flex: 1,
            height: '36px',
            borderRadius: '18px',
            border: '0.5px solid rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
          }}
        >
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '17px', fontWeight: 400 }}>
            iMessage
          </span>
        </div>
      </div>

      {/* Home indicator */}
      <div style={{ height: '5px', display: 'flex', justifyContent: 'center', paddingBottom: '8px' }}>
        <div style={{ width: '134px', height: '5px', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.3)' }} />
      </div>
    </div>
  );
}
