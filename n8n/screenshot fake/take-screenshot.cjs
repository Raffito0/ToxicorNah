#!/usr/bin/env node
/**
 * take-screenshot.cjs
 * Generates pixel-perfect iPhone chat screenshots from ContentScenario JSON.
 *
 * Usage:
 *   node take-screenshot.cjs --input scenario.json --output screenshot.png
 *   node take-screenshot.cjs --json '{"chat":...}' --output screenshot.png
 *
 * Supported appStyles: imessage, whatsapp, instagram
 * Output: 780x1688px PNG (2x Retina, 390x844 viewport)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ============================================================
// CLI ARGUMENT PARSING
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      parsed.input = args[++i];
    } else if (args[i] === '--json' && args[i + 1]) {
      parsed.json = args[++i];
    } else if (args[i] === '--base64' && args[i + 1]) {
      parsed.base64 = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      parsed.output = args[++i];
    }
  }
  return parsed;
}

// ============================================================
// SHARED: iOS STATUS BAR
// ============================================================

function renderStatusBar() {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 24px 0;height:54px;flex-shrink:0;">
      <span style="color:#fff;font-size:16px;font-weight:600;letter-spacing:0.5px;">9:41</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <!-- Cellular -->
        <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
          <rect x="0" y="8" width="3" height="4" rx="0.5" fill="#fff"/>
          <rect x="4" y="5.5" width="3" height="6.5" rx="0.5" fill="#fff"/>
          <rect x="8" y="3" width="3" height="9" rx="0.5" fill="#fff"/>
          <rect x="12" y="0" width="3" height="12" rx="0.5" fill="#fff"/>
        </svg>
        <!-- WiFi -->
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" fill="#fff"/>
          <path d="M4.5 8.5C5.5 7.2 6.7 6.5 8 6.5s2.5.7 3.5 2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M2 5.5C3.8 3.5 5.8 2.5 8 2.5s4.2 1 6 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Battery -->
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3" stroke="#fff" stroke-opacity="0.35"/>
          <rect x="2" y="2" width="17" height="9" rx="1.5" fill="#fff"/>
          <rect x="25" y="4" width="2" height="5" rx="1" fill="#fff" fill-opacity="0.4"/>
        </svg>
      </div>
    </div>`;
}

// ============================================================
// SHARED: HOME INDICATOR
// ============================================================

function renderHomeIndicator() {
  return `
    <div style="height:5px;display:flex;justify-content:center;padding-bottom:8px;">
      <div style="width:134px;height:5px;border-radius:3px;background-color:rgba(255,255,255,0.3);"></div>
    </div>`;
}

// ============================================================
// iMESSAGE TEMPLATE
// ============================================================

function renderIMessage(contactName, messages) {
  let messagesHtml = '';

  messages.forEach((msg, i) => {
    const isMe = msg.sender === 'me';
    const prevMsg = i > 0 ? messages[i - 1] : null;
    const nextMsg = i < messages.length - 1 ? messages[i + 1] : null;

    // Time label logic
    const showTime = msg.time && (!prevMsg || !prevMsg.time || prevMsg.time !== msg.time);

    // Grouping logic: determines bubble shape + tail
    const isFirstInGroup = !prevMsg || prevMsg.sender !== msg.sender || showTime;
    const nextShowTime = nextMsg && nextMsg.time && (!msg.time || msg.time !== nextMsg.time);
    const isLastInGroup = !nextMsg || nextMsg.sender !== msg.sender || !!nextShowTime;

    if (showTime) {
      messagesHtml += `
        <div style="text-align:center;color:rgba(255,255,255,0.35);font-size:11px;font-weight:400;padding:8px 0 4px;">
          ${msg.time}
        </div>`;
    }

    const marginTop = isFirstInGroup ? '8px' : '2px';
    const bubbleBg = isMe ? '#007AFF' : '#1C1C1E';

    // Border-radius: tight on sender's side for consecutive messages
    // Format: top-left top-right bottom-right bottom-left
    let borderRadius;
    if (isMe) {
      const topRight = isFirstInGroup ? '18px' : '6px';
      const bottomRight = isLastInGroup ? '14px' : '4px';
      borderRadius = '18px ' + topRight + ' ' + bottomRight + ' 18px';
    } else {
      const topLeft = isFirstInGroup ? '18px' : '6px';
      const bottomLeft = isLastInGroup ? '14px' : '4px';
      borderRadius = topLeft + ' 18px 18px ' + bottomLeft;
    }

    // Tail on the last message of each sender group
    // Tail on the last message of each sender group (SVG path)
    let tailHtml = '';
    if (isLastInGroup) {
      if (isMe) {
        const tailSvgPath = path.resolve(__dirname, 'Untitled design (6).svg');
        const tailSvgContent = fs.readFileSync(tailSvgPath, 'utf-8');
        const tailBase64 = Buffer.from(tailSvgContent).toString('base64');
        tailHtml = '<img src="data:image/svg+xml;base64,' + tailBase64 + '" style="position:absolute;bottom:-4px;right:-6px;width:22px;height:24px;display:block;" />';
      } else {
        const tailSvgPathThem = path.resolve(__dirname, 'Untitled design (5).svg');
        const tailSvgContentThem = fs.readFileSync(tailSvgPathThem, 'utf-8');
        const tailBase64Them = Buffer.from(tailSvgContentThem).toString('base64');
        tailHtml = '<img src="data:image/svg+xml;base64,' + tailBase64Them + '" style="position:absolute;bottom:-4px;left:-5px;width:22px;height:24px;display:block;transform:scaleX(-1);" />';
      }
    }

    // Side padding to leave room for tails
    const sidePad = isMe ? 'padding-right:12px;' : 'padding-left:12px;';

    messagesHtml += `
      <div style="display:flex;justify-content:${isMe ? 'flex-end' : 'flex-start'};margin-top:${marginTop};${sidePad}">
        <div style="max-width:265px;padding:8px 12px;border-radius:${borderRadius};background-color:${bubbleBg};color:#fff;font-size:17px;line-height:1.35;font-weight:400;letter-spacing:-0.2px;word-break:break-word;position:relative;">
          ${escapeHtml(msg.text)}
          ${tailHtml}
        </div>
      </div>`;
  });

  // Delivered indicator
  if (messages.length > 0 && messages[messages.length - 1].sender === 'me') {
    messagesHtml += `
      <div style="text-align:right;padding-right:12px;padding-top:2px;">
        <span style="color:rgba(255,255,255,0.35);font-size:11px;font-weight:400;">Delivered</span>
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div style="width:390px;height:844px;background-color:#000000;display:flex;flex-direction:column;font-family:-apple-system,'SF Pro Text','SF Pro Display','Helvetica Neue',Arial,sans-serif;overflow:hidden;position:relative;">

    ${renderStatusBar()}

    <!-- Chat Header -->
    <div style="display:flex;align-items:center;padding:8px 16px 12px;flex-shrink:0;border-bottom:0.5px solid rgba(255,255,255,0.1);position:relative;">
      <!-- Back arrow -->
      <svg width="12" height="20" viewBox="0 0 12 20" fill="none" style="margin-right:4px;">
        <path d="M10 2L2 10L10 18" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span style="color:#007AFF;font-size:17px;margin-right:auto;">&nbsp;</span>

      <!-- Contact info centered -->
      <div style="display:flex;flex-direction:column;align-items:center;position:absolute;left:50%;transform:translateX(-50%);">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6e6e73,#8e8e93);display:flex;align-items:center;justify-content:center;margin-bottom:4px;">
          <span style="color:#fff;font-size:18px;font-weight:500;">${contactName.charAt(0).toUpperCase()}</span>
        </div>
        <div style="display:flex;align-items:center;gap:3px;">
          <span style="color:#fff;font-size:13px;font-weight:600;">${escapeHtml(contactName)}</span>
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
            <path d="M1 1l5 5-5 5" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

      <!-- Right side: empty (clean look matching real iOS) -->
      <div style="margin-left:auto;width:22px;"></div>
    </div>

    <!-- Messages Area -->
    <div style="flex:1;overflow-y:auto;padding:12px 10px;display:flex;flex-direction:column;">
      ${messagesHtml}
    </div>

    <!-- Input Bar -->
    <div style="flex-shrink:0;padding:8px 12px 34px;border-top:0.5px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:8px;">
      <div style="width:34px;height:34px;border-radius:50%;background-color:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 4v12M4 10h12" stroke="#007AFF" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
      <div style="flex:1;height:36px;border-radius:18px;border:0.5px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:space-between;padding:0 14px;">
        <span style="color:rgba(255,255,255,0.25);font-size:17px;font-weight:400;">iMessage</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    ${renderHomeIndicator()}
  </div>
</body>
</html>`;
}

// ============================================================
// WHATSAPP TEMPLATE
// ============================================================

function renderWhatsApp(contactName, messages) {
  let messagesHtml = '';

  messages.forEach((msg, i) => {
    const isMe = msg.sender === 'me';
    const prevMsg = i > 0 ? messages[i - 1] : null;
    const sameSenderAsPrev = prevMsg && prevMsg.sender === msg.sender;
    const showTime = msg.time && (!prevMsg || !prevMsg.time || prevMsg.time !== msg.time);

    if (showTime) {
      messagesHtml += `
        <div style="display:flex;justify-content:center;padding:8px 0 4px;">
          <span style="background-color:#1D2831;color:rgba(233,237,239,0.6);font-size:12px;font-weight:400;padding:4px 12px;border-radius:8px;">
            ${msg.time}
          </span>
        </div>`;
    }

    const marginTop = sameSenderAsPrev && !showTime ? '2px' : '6px';
    const bubbleBg = isMe ? '#005C4B' : '#1F2C34';
    const bubbleRadius = isMe ? '10px 10px 3px 10px' : '10px 10px 10px 3px';
    const timeDisplay = msg.time ? msg.time.replace(/\s*(AM|PM)/gi, (m) => m.toLowerCase()) : '';

    // Double-check checkmark SVG for sent messages
    const checkmark = isMe ? `
      <svg width="18" height="10" viewBox="0 0 18 10" fill="none">
        <path d="M1 5.5l3 3 5.5-7" stroke="#53BDEB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 5.5l3 3 5.5-7" stroke="#53BDEB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>` : '';

    messagesHtml += `
      <div style="display:flex;justify-content:${isMe ? 'flex-end' : 'flex-start'};margin-top:${marginTop};">
        <div style="max-width:280px;padding:7px 11px;border-radius:${bubbleRadius};background-color:${bubbleBg};position:relative;">
          <span style="color:#E9EDEF;font-size:15.5px;line-height:1.35;font-weight:400;word-break:break-word;">
            ${escapeHtml(msg.text)}
          </span>
          <span style="float:right;margin-left:8px;margin-top:4px;display:flex;align-items:center;gap:3px;">
            <span style="color:rgba(233,237,239,0.4);font-size:11px;font-weight:400;">${timeDisplay}</span>
            ${checkmark}
          </span>
        </div>
      </div>`;
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div style="width:390px;height:844px;background-color:#0B141A;display:flex;flex-direction:column;font-family:-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif;overflow:hidden;position:relative;">

    ${renderStatusBar()}

    <!-- WhatsApp Header -->
    <div style="display:flex;align-items:center;padding:10px 12px 12px;flex-shrink:0;background-color:#1F2C34;">
      <!-- Back arrow -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="margin-right:4px;flex-shrink:0;">
        <path d="M15 19l-7-7 7-7" stroke="#00A884" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <!-- Avatar -->
      <div style="width:38px;height:38px;border-radius:50%;background-color:#2A3942;display:flex;align-items:center;justify-content:center;margin-right:12px;flex-shrink:0;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" fill="#687882"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#687882"/>
        </svg>
      </div>
      <!-- Name + status -->
      <div style="flex:1;">
        <div style="color:#E9EDEF;font-size:17px;font-weight:500;line-height:1.2;">${escapeHtml(contactName)}</div>
        <div style="color:rgba(233,237,239,0.5);font-size:13px;font-weight:400;">online</div>
      </div>
      <!-- Right icons -->
      <div style="display:flex;gap:20px;align-items:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M23 7l-7 5 7 5V7z" stroke="#AEBAC1" stroke-width="1.5" stroke-linejoin="round"/>
          <rect x="1" y="5" width="15" height="14" rx="2" stroke="#AEBAC1" stroke-width="1.5"/>
        </svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="#AEBAC1" stroke-width="1.5"/>
        </svg>
      </div>
    </div>

    <!-- Messages Area -->
    <div style="flex:1;overflow-y:auto;padding:12px 12px;display:flex;flex-direction:column;gap:3px;background-image:url(&quot;data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Ccircle cx='10' cy='10' r='1'/%3E%3Ccircle cx='40' cy='30' r='1'/%3E%3Ccircle cx='20' cy='50' r='1'/%3E%3C/g%3E%3C/svg%3E&quot;);">
      ${messagesHtml}
    </div>

    <!-- Input Bar -->
    <div style="flex-shrink:0;padding:6px 8px 34px;display:flex;align-items:center;gap:8px;background-color:#0B141A;">
      <div style="flex:1;height:42px;border-radius:24px;background-color:#1F2C34;display:flex;align-items:center;padding:0 12px;gap:10px;">
        <!-- Emoji -->
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="10" stroke="#8696A0" stroke-width="1.5"/>
          <circle cx="9" cy="10" r="1" fill="#8696A0"/>
          <circle cx="15" cy="10" r="1" fill="#8696A0"/>
          <path d="M8 14c1 2 3 3 4 3s3-1 4-3" stroke="#8696A0" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span style="color:rgba(233,237,239,0.35);font-size:16px;font-weight:400;flex:1;">Message</span>
        <!-- Attachment -->
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="#8696A0" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Camera -->
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;">
          <rect x="2" y="6" width="20" height="14" rx="3" stroke="#8696A0" stroke-width="1.5"/>
          <circle cx="12" cy="13" r="4" stroke="#8696A0" stroke-width="1.5"/>
          <path d="M8 2l2 4h4l2-4" stroke="#8696A0" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <!-- Mic button -->
      <div style="width:42px;height:42px;border-radius:50%;background-color:#00A884;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" fill="#fff"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M12 19v4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    ${renderHomeIndicator()}
  </div>
</body>
</html>`;
}

// ============================================================
// INSTAGRAM DM TEMPLATE
// ============================================================

function renderInstagramDM(contactName, messages) {
  let messagesHtml = '';

  messages.forEach((msg, i) => {
    const isMe = msg.sender === 'me';
    const prevMsg = i > 0 ? messages[i - 1] : null;
    const sameSenderAsPrev = prevMsg && prevMsg.sender === msg.sender;
    const showTime = msg.time && (!prevMsg || !prevMsg.time || prevMsg.time !== msg.time);

    if (showTime) {
      messagesHtml += `
        <div style="text-align:center;color:rgba(255,255,255,0.35);font-size:12px;font-weight:400;padding:12px 0 6px;">
          ${msg.time}
        </div>`;
    }

    const marginTop = sameSenderAsPrev && !showTime ? '2px' : '8px';
    const bubbleRadius = isMe ? '22px 22px 4px 22px' : '22px 22px 22px 4px';
    const bubbleBg = isMe
      ? 'background:linear-gradient(135deg,#5B51D8,#833AB4);'
      : 'background-color:#262626;';

    // Show avatar for first message in their group
    let avatarHtml = '';
    if (!isMe && (!sameSenderAsPrev || showTime)) {
      avatarHtml = `
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#833AB4,#FD1D1D);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <div style="width:24px;height:24px;border-radius:50%;background-color:#000;display:flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:11px;font-weight:600;">${contactName.charAt(0).toUpperCase()}</span>
          </div>
        </div>`;
    } else if (!isMe) {
      avatarHtml = `<div style="width:28px;flex-shrink:0;"></div>`;
    }

    messagesHtml += `
      <div style="display:flex;justify-content:${isMe ? 'flex-end' : 'flex-start'};align-items:flex-end;gap:8px;margin-top:${marginTop};">
        ${avatarHtml}
        <div style="max-width:260px;padding:10px 16px;border-radius:${bubbleRadius};${bubbleBg}color:#fff;font-size:15px;line-height:1.35;font-weight:400;word-break:break-word;">
          ${escapeHtml(msg.text)}
        </div>
      </div>`;
  });

  // Seen indicator
  if (messages.length > 0 && messages[messages.length - 1].sender === 'me') {
    messagesHtml += `
      <div style="text-align:right;padding-right:4px;padding-top:4px;">
        <span style="color:rgba(255,255,255,0.35);font-size:11px;font-weight:400;">Seen</span>
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div style="width:390px;height:844px;background-color:#000000;display:flex;flex-direction:column;font-family:-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif;overflow:hidden;position:relative;">

    ${renderStatusBar()}

    <!-- Instagram DM Header -->
    <div style="display:flex;align-items:center;padding:10px 16px 14px;flex-shrink:0;border-bottom:0.5px solid rgba(255,255,255,0.08);">
      <!-- Back arrow -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="margin-right:12px;flex-shrink:0;">
        <path d="M15 19l-7-7 7-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <!-- Avatar -->
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#833AB4,#FD1D1D,#F77737);display:flex;align-items:center;justify-content:center;margin-right:12px;flex-shrink:0;">
        <div style="width:32px;height:32px;border-radius:50%;background-color:#000;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:15px;font-weight:600;">${contactName.charAt(0).toUpperCase()}</span>
        </div>
      </div>
      <!-- Name + status -->
      <div style="flex:1;">
        <div style="color:#fff;font-size:16px;font-weight:600;line-height:1.2;">${escapeHtml(contactName)}</div>
        <div style="color:rgba(255,255,255,0.5);font-size:12px;font-weight:400;">Active now</div>
      </div>
      <!-- Right icons -->
      <div style="display:flex;gap:20px;align-items:center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="#fff" stroke-width="1.5"/>
        </svg>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M23 7l-7 5 7 5V7z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
          <rect x="1" y="5" width="15" height="14" rx="2" stroke="#fff" stroke-width="1.5"/>
        </svg>
      </div>
    </div>

    <!-- Messages Area -->
    <div style="flex:1;overflow-y:auto;padding:16px 16px;display:flex;flex-direction:column;gap:4px;">
      ${messagesHtml}
    </div>

    <!-- Input Bar -->
    <div style="flex-shrink:0;padding:10px 12px 34px;border-top:0.5px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:12px;">
      <!-- Camera icon -->
      <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#405DE6,#833AB4);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="15" rx="3" stroke="#fff" stroke-width="1.5"/>
          <circle cx="12" cy="12.5" r="4" stroke="#fff" stroke-width="1.5"/>
        </svg>
      </div>
      <!-- Text input -->
      <div style="flex:1;height:40px;border-radius:22px;border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;padding:0 16px;">
        <span style="color:rgba(255,255,255,0.3);font-size:15px;font-weight:400;">Message...</span>
      </div>
      <!-- Mic icon -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="#fff" stroke-width="1.5"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M12 19v4m-4 0h8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </div>

    ${renderHomeIndicator()}
  </div>
</body>
</html>`;
}

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// MAIN: PUPPETEER SCREENSHOT PIPELINE
// ============================================================


async function takeScreenshot(scenario, outputPath) {
  const { contactName, appStyle, messages } = scenario.chat;

  // Select template
  let html;
  switch (appStyle) {
    case 'whatsapp':
      html = renderWhatsApp(contactName, messages);
      break;
    case 'instagram':
      html = renderInstagramDM(contactName, messages);
      break;
    case 'imessage':
    default:
      html = renderIMessage(contactName, messages);
      break;
  }

  // Ensure output directory exists (skip when returning buffer)
  if (outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // iPhone 14 Pro viewport at 2x Retina
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
  });

  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Replace emojis with Twemoji SVGs (iOS-like, not Windows Segoe UI)
  try {
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/@twemoji/api@latest/dist/twemoji.min.js' });
    await page.evaluate(() => {
      if (typeof twemoji !== 'undefined') {
        twemoji.parse(document.body, {
          folder: 'svg',
          ext: '.svg',
          base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/'
        });
        // Style twemoji images to match text size
        document.querySelectorAll('img.emoji').forEach(img => {
          img.style.height = '1.1em';
          img.style.width = '1.1em';
          img.style.verticalAlign = '-0.1em';
          img.style.display = 'inline';
        });
      }
    });
  } catch (e) {
    console.warn('Twemoji load failed, using system emojis:', e.message);
  }

  // Take screenshot
  const screenshotOptions = {
    type: 'png',
    clip: {
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    },
  };

  // If outputPath provided, save to file. Otherwise return buffer.
  if (outputPath) {
    screenshotOptions.path = outputPath;
    await page.screenshot(screenshotOptions);
    await browser.close();
    console.log('Screenshot saved to: ' + outputPath);
    return outputPath;
  } else {
    const buffer = await page.screenshot(screenshotOptions);
    await browser.close();
    return buffer;
  }
}

// Export for use by screenshot-server.cjs
module.exports = { takeScreenshot };

// ============================================================
// CLI ENTRY POINT
// ============================================================

async function main() {
  const args = parseArgs();

  // Load scenario
  let scenario;
  if (args.base64) {
    scenario = JSON.parse(Buffer.from(args.base64, 'base64').toString('utf-8'));
  } else if (args.json) {
    scenario = JSON.parse(args.json);
  } else if (args.input) {
    const inputPath = path.resolve(args.input);
    const raw = fs.readFileSync(inputPath, 'utf-8');
    scenario = JSON.parse(raw);
  } else {
    console.error('Usage: node take-screenshot.cjs --input <scenario.json> --output <screenshot.png>');
    console.error('       node take-screenshot.cjs --json \'{"chat":...}\' --output <screenshot.png>');
    process.exit(1);
  }

  // Determine output path
  const outputPath = args.output
    ? path.resolve(args.output)
    : path.resolve('screenshot.png');

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await takeScreenshot(scenario, outputPath);
}

// Only run CLI when called directly (not when imported by screenshot-server)
if (require.main === module) {
  main().catch((err) => {
    console.error('Screenshot failed:', err);
    process.exit(1);
  });
}
