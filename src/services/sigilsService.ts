// ===== SIGILS SERVICE =====
// Manages Inner Truth weekly drops and Mirror anonymous truths

export type InnerTruthRubric = 'blind_spot' | 'pattern' | 'emotional_roi' | 'one_move';

export interface InnerTruthContent {
  id: string;
  rubric: InnerTruthRubric;
  rubricLabel: string;
  title: string;
  bigLine: string;
  why?: string;
  move: string;
  canShare: boolean; // Only blind_spot and emotional_roi
  weekNumber: number;
  createdAt: string;
}

export interface MirrorTruth {
  id: string;
  content: string;
  fromUserId: string; // Anonymous
  createdAt: string;
  isNew: boolean;
}

export interface MirrorSummary {
  id: string;
  summary: string;
  truthCount: number;
  unlockedAt: string;
}

export interface SigilsState {
  // Inner Truth
  innerTruth: {
    current: InnerTruthContent | null;
    state: 'sealed' | 'opened' | 'waiting';
    nextDropIn: number; // days
    lastOpenedAt: string | null;
  };
  // Mirror
  mirror: {
    newTruths: MirrorTruth[];
    summary: MirrorSummary | null;
    waitingCount: number; // How many more needed for summary
    hasActiveRequest: boolean;
  };
  // Badge state
  badge: {
    hasNew: boolean;
    count: number;
    priority: 'gold' | 'silver' | null; // gold = Inner Truth, silver = Mirror
  };
}

// ===== RUBRIC LABELS =====
const RUBRIC_LABELS: Record<InnerTruthRubric, string> = {
  blind_spot: 'Blind Spot',
  pattern: 'Pattern',
  emotional_roi: 'Emotional ROI',
  one_move: 'One Move',
};

// ===== INNER TRUTH CONTENT LIBRARY =====
// Each rubric has multiple possible truths that rotate weekly
const INNER_TRUTH_LIBRARY: Record<InnerTruthRubric, Omit<InnerTruthContent, 'id' | 'rubric' | 'rubricLabel' | 'weekNumber' | 'createdAt' | 'canShare'>[]> = {
  blind_spot: [
    {
      title: 'The Comfort Trap',
      bigLine: "You're not in love with him. You're in love with not being alone.",
      why: "Comfort feels like connection, but it's not the same thing.",
      move: "Ask yourself: would I choose him if I wasn't afraid?",
    },
    {
      title: 'The Fixer Fantasy',
      bigLine: "You think you can heal him. You can't.",
      why: "His wounds are not your project.",
      move: "Write down 3 things you've tried to fix. Let them go.",
    },
    {
      title: 'The Potential Lie',
      bigLine: "You fell for who he could be, not who he is.",
      why: "Potential is a story you tell yourself.",
      move: "List 5 things he actually does, not what he promises.",
    },
    {
      title: 'The Silence Decoder',
      bigLine: "His silence isn't a mystery. It's an answer.",
      why: "You already know what it means.",
      move: "Stop waiting. Send one message, then stop.",
    },
  ],
  pattern: [
    {
      title: 'The Chase Loop',
      bigLine: "You only want him when he pulls away.",
      why: "Anxiety feels like attraction.",
      move: "Notice when you feel the pull. Wait 24 hours before acting.",
    },
    {
      title: 'The Emotional Overdraft',
      bigLine: "You give 80%. He gives when convenient.",
      why: "Imbalance becomes invisible when you're used to it.",
      move: "For one week, match his energy exactly. See what happens.",
    },
    {
      title: 'The Unavailable Magnet',
      bigLine: "Emotionally unavailable isn't a type. It's a pattern.",
      why: "You keep choosing what feels familiar, not what feels good.",
      move: "Name the last 3 people you dated. What do they have in common?",
    },
    {
      title: 'The Breadcrumb Diet',
      bigLine: "You survive on crumbs and call it a relationship.",
      why: "Low expectations don't mean you're low maintenance.",
      move: "What would 'enough' actually look like? Write it down.",
    },
  ],
  emotional_roi: [
    {
      title: 'The Time Audit',
      bigLine: "147 hours texting him. 0 hours feeling secure.",
      why: "Time spent ≠ love received.",
      move: "Calculate your emotional investment. Is it worth it?",
    },
    {
      title: 'The Energy Equation',
      bigLine: "You spent 3 months decoding his texts. He spent 3 seconds writing them.",
      why: "The math doesn't add up.",
      move: "Stop analyzing. Start observing what he actually does.",
    },
    {
      title: 'The Anxiety Tax',
      bigLine: "Every situationship costs you sleep, focus, and peace.",
      why: "The price is higher than you think.",
      move: "Track your anxiety this week. Notice when it spikes.",
    },
    {
      title: 'The Opportunity Cost',
      bigLine: "While waiting for his text, you missed 12 real connections.",
      why: "Scarcity isn't attraction. It's a trap.",
      move: "Say yes to one new thing this week. Anything but him.",
    },
  ],
  one_move: [
    {
      title: 'The 24-Hour Rule',
      bigLine: "Don't reply for 24 hours. See how you feel.",
      move: "Set a timer. Your clarity will thank you.",
    },
    {
      title: 'The Mirror Text',
      bigLine: "Match his response time. Exactly.",
      move: "If he takes 5 hours, you take 5 hours. No exceptions.",
    },
    {
      title: 'The Exit Draft',
      bigLine: "Write the goodbye text. Don't send it yet.",
      move: "Having it ready changes everything.",
    },
    {
      title: 'The Block Experiment',
      bigLine: "Block him for 48 hours. Just to see.",
      move: "You can always unblock. But first, feel the freedom.",
    },
  ],
};

// ===== HELPER FUNCTIONS =====

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.floor(diff / oneWeek);
}

function getDaysUntilSunday(): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0) return 0; // It's Sunday
  return 7 - dayOfWeek;
}

function selectRubric(recentMoods: string[], scanCount: number, isInactive: boolean): InnerTruthRubric {
  // Smart selection based on user behavior
  if (isInactive) {
    return 'emotional_roi'; // Shock to reactivate
  }

  const hasAnxiousMood = recentMoods.some(m => m === 'anxious' || m === 'miss');
  if (hasAnxiousMood) {
    return Math.random() > 0.5 ? 'blind_spot' : 'one_move';
  }

  if (scanCount > 5) {
    return Math.random() > 0.5 ? 'pattern' : 'emotional_roi';
  }

  // Default: rotate based on week
  const rubrics: InnerTruthRubric[] = ['blind_spot', 'pattern', 'emotional_roi', 'one_move'];
  const weekNum = getWeekNumber();
  return rubrics[weekNum % 4];
}

function generateInnerTruth(rubric: InnerTruthRubric): InnerTruthContent {
  const library = INNER_TRUTH_LIBRARY[rubric];
  const weekNum = getWeekNumber();
  const content = library[weekNum % library.length];

  return {
    id: `inner-truth-${weekNum}`,
    rubric,
    rubricLabel: RUBRIC_LABELS[rubric],
    ...content,
    canShare: rubric === 'blind_spot' || rubric === 'emotional_roi',
    weekNumber: weekNum,
    createdAt: new Date().toISOString(),
  };
}

// ===== LOCAL STORAGE KEYS =====
const STORAGE_KEYS = {
  INNER_TRUTH_OPENED: 'sigils_inner_truth_opened',
  INNER_TRUTH_WEEK: 'sigils_inner_truth_week',
  MIRROR_SEEN: 'sigils_mirror_seen',
  RECENT_MOODS: 'sigils_recent_moods',
};

// ===== MAIN SERVICE FUNCTIONS =====

export async function fetchSigilsState(): Promise<SigilsState> {
  const currentWeek = getWeekNumber();
  const lastOpenedWeek = localStorage.getItem(STORAGE_KEYS.INNER_TRUTH_WEEK);
  const wasOpened = lastOpenedWeek === String(currentWeek);

  // Determine Inner Truth state
  let innerTruthState: 'sealed' | 'opened' | 'waiting';
  if (wasOpened) {
    innerTruthState = 'opened';
  } else {
    // Check if it's available (Sunday has passed)
    const now = new Date();
    const isSunday = now.getDay() === 0;
    const hour = now.getHours();
    const isDropTime = isSunday && hour >= 19; // 7pm Sunday

    if (isDropTime || getDaysUntilSunday() === 0) {
      innerTruthState = 'sealed';
    } else {
      innerTruthState = 'waiting';
    }
  }

  // For demo purposes, always show as sealed if not opened this week
  if (!wasOpened) {
    innerTruthState = 'sealed';
  }

  // Get recent moods from storage
  const recentMoodsStr = localStorage.getItem(STORAGE_KEYS.RECENT_MOODS);
  const recentMoods: string[] = recentMoodsStr ? JSON.parse(recentMoodsStr) : [];

  // Select rubric based on behavior
  const rubric = selectRubric(recentMoods, 3, false); // TODO: Get real scan count
  const innerTruthContent = innerTruthState !== 'waiting' ? generateInnerTruth(rubric) : null;

  // Mirror state (mock for now)
  const mirrorSeenStr = localStorage.getItem(STORAGE_KEYS.MIRROR_SEEN);
  const mirrorSeen: string[] = mirrorSeenStr ? JSON.parse(mirrorSeenStr) : [];

  // Mock mirror truths
  const mockMirrorTruths: MirrorTruth[] = [
    {
      id: 'mirror-1',
      content: "She's always the one texting first.",
      fromUserId: 'anon-1',
      createdAt: new Date().toISOString(),
      isNew: !mirrorSeen.includes('mirror-1'),
    },
    {
      id: 'mirror-2',
      content: "She deserves someone who shows up.",
      fromUserId: 'anon-2',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      isNew: !mirrorSeen.includes('mirror-2'),
    },
  ];

  const newMirrorCount = mockMirrorTruths.filter(t => t.isNew).length;
  const hasNewInnerTruth = innerTruthState === 'sealed';

  // Calculate badge
  let badgePriority: 'gold' | 'silver' | null = null;
  let badgeCount = 0;

  if (hasNewInnerTruth) {
    badgePriority = 'gold';
    badgeCount++;
  }
  if (newMirrorCount > 0) {
    if (!badgePriority) badgePriority = 'silver';
    badgeCount += newMirrorCount;
  }

  return {
    innerTruth: {
      current: innerTruthContent,
      state: innerTruthState,
      nextDropIn: getDaysUntilSunday(),
      lastOpenedAt: wasOpened ? localStorage.getItem(STORAGE_KEYS.INNER_TRUTH_OPENED) : null,
    },
    mirror: {
      newTruths: mockMirrorTruths,
      summary: null, // TODO: Implement summary unlock logic
      waitingCount: 3 - mockMirrorTruths.length, // Need 3 for summary
      hasActiveRequest: false,
    },
    badge: {
      hasNew: badgeCount > 0,
      count: badgeCount,
      priority: badgePriority,
    },
  };
}

export function markInnerTruthOpened(): void {
  const currentWeek = getWeekNumber();
  localStorage.setItem(STORAGE_KEYS.INNER_TRUTH_WEEK, String(currentWeek));
  localStorage.setItem(STORAGE_KEYS.INNER_TRUTH_OPENED, new Date().toISOString());
}

export function markMirrorTruthSeen(truthId: string): void {
  const seenStr = localStorage.getItem(STORAGE_KEYS.MIRROR_SEEN);
  const seen: string[] = seenStr ? JSON.parse(seenStr) : [];
  if (!seen.includes(truthId)) {
    seen.push(truthId);
    localStorage.setItem(STORAGE_KEYS.MIRROR_SEEN, JSON.stringify(seen));
  }
}

export function saveMood(mood: string): void {
  const moodsStr = localStorage.getItem(STORAGE_KEYS.RECENT_MOODS);
  const moods: string[] = moodsStr ? JSON.parse(moodsStr) : [];
  moods.push(mood);
  // Keep only last 7 days worth (assuming one mood per day)
  const recent = moods.slice(-7);
  localStorage.setItem(STORAGE_KEYS.RECENT_MOODS, JSON.stringify(recent));
}

// ===== SHARE TEMPLATE =====
export function generateShareImage(content: InnerTruthContent): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 1080;
    canvas.height = 1920;

    // Background - dark with gold accent
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#0f0f1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Gold accent line
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.3, 400);
    ctx.lineTo(canvas.width * 0.7, 400);
    ctx.stroke();

    // Eyebrow
    ctx.fillStyle = 'rgba(212, 175, 55, 0.8)';
    ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INNER TRUTH', canvas.width / 2, 500);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 48px "Satoshi", sans-serif';
    ctx.fillText(content.title, canvas.width / 2, 580);

    // Big line (wrapped)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '500 36px "Plus Jakarta Sans", sans-serif';
    const words = content.bigLine.split(' ');
    let line = '';
    let y = 720;
    const maxWidth = canvas.width * 0.8;

    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line.trim(), canvas.width / 2, y);
        line = word + ' ';
        y += 50;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), canvas.width / 2, y);

    // Divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.3, y + 80);
    ctx.lineTo(canvas.width * 0.7, y + 80);
    ctx.stroke();

    // Branding
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('toxic or nah', canvas.width / 2, 1700);

    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
