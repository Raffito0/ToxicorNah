// Soul Type Duality Map — "Your Two Sides" / Daily Truth
// 16 female Soul Types × 4 light traits + 4 shadow traits
// Rotates daily: 1 light + 1 shadow per day

export interface DualityTrait {
  trait: string;
  tagline: string;
}

export interface SoulTypeDuality {
  light: DualityTrait[];
  shadow: DualityTrait[];
}

export const SOUL_TYPE_DUALITY_MAP: Record<string, SoulTypeDuality> = {
  'The Love Rush': {
    light: [
      { trait: 'All-In Energy', tagline: "When you love, you love with your whole chest. No half-measures." },
      { trait: 'Fearless Heart', tagline: "You're not afraid to say it first, feel it first, risk it all first." },
      { trait: 'Emotional Courage', tagline: "You walk into love like it can't hurt you. That takes guts." },
      { trait: 'Magnetic Warmth', tagline: "People feel safe around you because you lead with your heart." },
    ],
    shadow: [
      { trait: 'Love Blindness', tagline: "You see the person you want him to be, not the person he is." },
      { trait: 'Attachment Addiction', tagline: "You'd rather be in the wrong relationship than be alone with yourself." },
      { trait: 'Boundary Erosion', tagline: "You give access before he earns it. Every. Single. Time." },
      { trait: 'Fantasy Projection', tagline: "You fall in love with potential and then wonder why reality disappoints." },
    ],
  },

  'The Natural State': {
    light: [
      { trait: 'Authentic Presence', tagline: "What he sees is what he gets. You don't perform — you just are." },
      { trait: 'Grounded Energy', tagline: "You're the calm in the chaos. Steady when everything else shakes." },
      { trait: 'Effortless Trust', tagline: "People open up to you because you make honesty feel safe." },
      { trait: 'Genuine Connection', tagline: "You don't play games. Real is the only language you speak." },
    ],
    shadow: [
      { trait: 'Passive Acceptance', tagline: "You tolerate what should be unacceptable because confrontation feels unnatural." },
      { trait: 'Conflict Avoidance', tagline: "You'd rather swallow the hurt than disrupt the peace." },
      { trait: 'Over-Trusting', tagline: "Your openness becomes a door that anyone can walk through — even those who shouldn't." },
      { trait: 'Invisible Standards', tagline: "You're so easygoing you forgot to tell him what you actually need." },
    ],
  },

  'The Fire Dance': {
    light: [
      { trait: 'Unbridled Passion', tagline: "You love like a wildfire — consuming, transformative, impossible to ignore." },
      { trait: 'Raw Honesty', tagline: "You don't sugarcoat. He always knows exactly where he stands." },
      { trait: 'Fierce Loyalty', tagline: "When you're in, you're ride-or-die. No half-measures, no backup plans." },
      { trait: 'Electric Presence', tagline: "A room changes when you walk in. You can't be background noise." },
    ],
    shadow: [
      { trait: 'Chaos Addiction', tagline: "Calm love feels boring to you. You mistake turbulence for passion." },
      { trait: 'Destructive Patterns', tagline: "When it's good, it's fire. When it's bad, you burn the whole thing down." },
      { trait: 'Emotional Extremes', tagline: "There's no middle ground with you — it's all or nothing, and nothing survives that." },
      { trait: 'Self-Sabotage', tagline: "You destroy good things because they don't feel intense enough to be real." },
    ],
  },

  'The Frozen Bloom': {
    light: [
      { trait: 'Self-Protection', tagline: "Your walls aren't weakness — they're proof you learned from the last time." },
      { trait: 'Selective Trust', tagline: "Not everyone deserves access to you. You know that now." },
      { trait: 'Quiet Strength', tagline: "You don't need anyone to survive. That's power most people never find." },
      { trait: 'Resilient Core', tagline: "Underneath the ice, something beautiful survived. And it's still growing." },
    ],
    shadow: [
      { trait: 'Emotional Shutdown', tagline: "You don't just guard your heart — you pretend it doesn't exist." },
      { trait: 'Intimacy Avoidance', tagline: "The closer someone gets, the colder you become. It's automatic." },
      { trait: 'Punishing the Present', tagline: "He didn't hurt you. But your walls don't know the difference." },
      { trait: 'Frozen Potential', tagline: "You're so afraid of being hurt again that you've stopped growing." },
    ],
  },

  'The Torn Silk': {
    light: [
      { trait: 'Elegant Resilience', tagline: "You broke beautifully. There's grace in how you carry your scars." },
      { trait: 'Deep Empathy', tagline: "Your pain made you understand others' pain. That's a rare gift." },
      { trait: 'Emotional Depth', tagline: "You feel things most people skim over. That's not weakness — it's range." },
      { trait: 'Survivor\'s Wisdom', tagline: "Every tear taught you something. You're walking proof that broken doesn't mean finished." },
    ],
    shadow: [
      { trait: 'Wound Identity', tagline: "Your pain became your personality. But you're more than what hurt you." },
      { trait: 'Trauma Bonding', tagline: "You connect deepest with people who are as damaged as you. That's not love — it's familiarity." },
      { trait: 'Fragility Complex', tagline: "You expect to break again. So you do — because you already decided you would." },
      { trait: 'Over-Giving', tagline: "You drain yourself for crumbs because you think your cracks make you unworthy of more." },
    ],
  },

  'The Inner Voice': {
    light: [
      { trait: 'Razor Intuition', tagline: "You feel the lie before he finishes the sentence." },
      { trait: 'Self-Awareness', tagline: "You know your patterns better than anyone. That's the first step to breaking them." },
      { trait: 'Emotional Intelligence', tagline: "You read rooms, read people, read between lines. Nothing gets past you." },
      { trait: 'Truth Compass', tagline: "Your gut never lies. When you listen, you're always right." },
    ],
    shadow: [
      { trait: 'Analysis Paralysis', tagline: "You think so deeply you talk yourself out of things that were actually right." },
      { trait: 'Hyper-Vigilance', tagline: "You're so busy scanning for danger that you can't relax into love." },
      { trait: 'Trust Hesitation', tagline: "You know too much about human nature. It makes it hard to let anyone in." },
      { trait: 'Emotional Overthinking', tagline: "You dissect every text, every pause, every word — until the magic dies under the microscope." },
    ],
  },

  'The Silent Venom': {
    light: [
      { trait: 'Strategic Mind', tagline: "You never move without purpose. Every word is calculated, every silence intentional." },
      { trait: 'Quiet Power', tagline: "You don't need to be loud to be the most dangerous person in the room." },
      { trait: 'Emotional Control', tagline: "While others react, you observe. That's your superpower." },
      { trait: 'Self-Sufficiency', tagline: "You don't need him. You never did. And that terrifies the weak ones." },
    ],
    shadow: [
      { trait: 'Emotional Weaponry', tagline: "When hurt, you don't cry — you calculate. And your aim is perfect." },
      { trait: 'Cold Withdrawal', tagline: "You go silent and let him suffer in the void. It's effective, but it's not communication." },
      { trait: 'Toxic Patience', tagline: "You wait for the perfect moment to strike. Forgiveness isn't in your vocabulary." },
      { trait: 'Isolation Tendency', tagline: "You push people away before they can disappoint you. Lonely, but safe." },
    ],
  },

  'The Sunset Soul': {
    light: [
      { trait: 'Bottomless Warmth', tagline: "Your love makes people feel like the only person in the world." },
      { trait: 'Nurturing Spirit', tagline: "You heal people just by being near them. That's not learned — it's who you are." },
      { trait: 'Selfless Devotion', tagline: "You show up for people who never asked. And you never keep score." },
      { trait: 'Emotional Generosity', tagline: "You give love in a language that makes people feel truly seen." },
    ],
    shadow: [
      { trait: 'Self-Erasure', tagline: "You pour until there's nothing left, then wonder why you feel invisible." },
      { trait: 'Savior Complex', tagline: "You confuse being needed with being loved. They're not the same." },
      { trait: 'Boundary Blindness', tagline: "You don't know where you end and he begins. That's not love — it's disappearing." },
      { trait: 'Exhaustion Cycle', tagline: "You give, you drain, you crash. Then you do it all over again." },
    ],
  },

  'The Deep Shadow': {
    light: [
      { trait: 'Mystical Depth', tagline: "You see things others don't. Your perception operates on a different frequency." },
      { trait: 'Protective Privacy', tagline: "Not everyone deserves to know you. That selectivity is wisdom." },
      { trait: 'Intense Focus', tagline: "When you choose someone, they get ALL of you. The depth is intoxicating." },
      { trait: 'Dark Wisdom', tagline: "You've sat with the shadows long enough to understand what others run from." },
    ],
    shadow: [
      { trait: 'Emotional Hiding', tagline: "You've made the darkness so comfortable that light feels like an attack." },
      { trait: 'Connection Resistance', tagline: "You want to be known but make it impossible for anyone to reach you." },
      { trait: 'Self-Isolation', tagline: "Alone isn't the same as safe. But you've convinced yourself it is." },
      { trait: 'Disappearing Act', tagline: "When things get real, you don't leave — you just stop existing in the space." },
    ],
  },

  'The Wild Luxury': {
    light: [
      { trait: 'Unapologetic Standards', tagline: "You know what you're worth and you're not taking less. Period." },
      { trait: 'Bold Confidence', tagline: "You walk into rooms like you own them. Because energetically, you do." },
      { trait: 'Life Force', tagline: "You make everything feel like an event. Boring doesn't exist in your orbit." },
      { trait: 'Self-Investment', tagline: "You put yourself first without apology. That's not selfish — it's smart." },
    ],
    shadow: [
      { trait: 'Material Validation', tagline: "You measure love in gestures and gifts. Presence alone never feels like enough." },
      { trait: 'Attention Dependency', tagline: "If he's not admiring you, you assume he's losing interest." },
      { trait: 'Surface Reading', tagline: "You pick men like brands — for the image, not the substance." },
      { trait: 'Entitlement Trap', tagline: "Expecting to be treated like a queen is fair. Expecting it without reciprocity isn't." },
    ],
  },

  'The Living Maze': {
    light: [
      { trait: 'Complex Intelligence', tagline: "Your mind works on seventeen levels at once. Most people can't keep up." },
      { trait: 'Creative Problem-Solving', tagline: "You see solutions in places others don't even look." },
      { trait: 'Emotional Nuance', tagline: "While others see black and white, you see every shade. That's depth, not confusion." },
      { trait: 'Philosophical Nature', tagline: "You ask the questions everyone else is too afraid to think about." },
    ],
    shadow: [
      { trait: 'Spiral Tendency', tagline: "One thought becomes a hundred. By midnight, a text means the relationship is over." },
      { trait: 'Decision Paralysis', tagline: "You overthink until every option feels wrong and not choosing becomes the choice." },
      { trait: 'Anxiety Loop', tagline: "Your brain runs worst-case scenarios on repeat. You're exhausted before anything even happens." },
      { trait: 'Self-Created Chaos', tagline: "Sometimes the maze isn't him — it's the story you built in your head." },
    ],
  },

  'The Golden Rule': {
    light: [
      { trait: 'Unshakable Standards', tagline: "You don't lower the bar. You let the wrong ones walk under it." },
      { trait: 'Self-Worth Mastery', tagline: "You know your value like you know your name. Non-negotiable." },
      { trait: 'Healthy Boundaries', tagline: "You draw lines with love, not anger. And you never apologize for them." },
      { trait: 'Sovereign Energy', tagline: "You don't need a relationship to feel complete. That's the most attractive thing about you." },
    ],
    shadow: [
      { trait: 'Perfection Prison', tagline: "Your standards are so specific that no real human can meet them." },
      { trait: 'Emotional Distance', tagline: "Being strong became being unreachable. There's a difference you stopped noticing." },
      { trait: 'Judgment Reflex', tagline: "You dismiss people too quickly. Not every imperfection is a dealbreaker." },
      { trait: 'Vulnerability Block', tagline: "You've mastered self-protection so well that you've locked yourself in." },
    ],
  },

  'The Savage Grace': {
    light: [
      { trait: 'Elegant Power', tagline: "You destroy with a smile. No raised voice, no broken dishes — just precision." },
      { trait: 'Fearless Independence', tagline: "You move through life like nothing can touch you. And honestly, almost nothing can." },
      { trait: 'Magnetic Authority', tagline: "People don't just notice you — they move out of your way." },
      { trait: 'Predator Instinct', tagline: "You sense weakness, dishonesty, and games before anyone says a word." },
    ],
    shadow: [
      { trait: 'Emotional Armor', tagline: "You're so strong that nobody knows when you're breaking. Including you." },
      { trait: 'Intimidation Effect', tagline: "Your power scares good people away. Not everyone is your opponent." },
      { trait: 'Control Need', tagline: "You'd rather dominate than be vulnerable. Softness feels like danger." },
      { trait: 'Loneliness of Strength', tagline: "You can handle everything alone. But should you?" },
    ],
  },

  'The Quiet Storm': {
    light: [
      { trait: 'Patient Power', tagline: "You observe everything and react to nothing. That's the most dangerous kind of calm." },
      { trait: 'Composed Grace', tagline: "While others lose their minds, you're already three steps ahead." },
      { trait: 'Deep Perception', tagline: "You see what people try to hide. Silence is your interrogation method." },
      { trait: 'Selective Response', tagline: "You speak when it matters. And when you do, it lands." },
    ],
    shadow: [
      { trait: 'Suppressed Fury', tagline: "You bottle everything until the storm breaks. And when it does, nothing survives." },
      { trait: 'Passive Aggression', tagline: "Your silence isn't always peace — sometimes it's punishment, and he knows it." },
      { trait: 'Emotional Numbness', tagline: "You've been patient so long you forgot what feeling looks like." },
      { trait: 'Withdrawal Reflex', tagline: "Instead of fighting, you disappear. Quiet isn't always healthy." },
    ],
  },

  'The Rising Phoenix': {
    light: [
      { trait: 'Comeback Energy', tagline: "Every time you burn, you come back brighter. That's not luck — it's who you are." },
      { trait: 'Transformative Strength', tagline: "Your worst moments became your best lessons. Most people don't survive what you've grown from." },
      { trait: 'Inspiring Resilience', tagline: "People look at your story and find the courage to start theirs." },
      { trait: 'Evolved Perspective', tagline: "You've seen the bottom. It doesn't scare you anymore. That's freedom." },
    ],
    shadow: [
      { trait: 'Survival Mode', tagline: "You're so used to fighting that you don't know how to rest." },
      { trait: 'Trauma Armor', tagline: "Your strength became a shield. But shields also keep love out." },
      { trait: 'Test Mentality', tagline: "You test everyone because the last person who got close destroyed you." },
      { trait: 'Restless Energy', tagline: "You're always rising, always rebuilding. When do you just... live?" },
    ],
  },

  'The Liquid Mirror': {
    light: [
      { trait: 'Adaptive Intelligence', tagline: "You read people instantly and adjust. Social brilliance that looks effortless." },
      { trait: 'Deep Empathy', tagline: "You feel what others feel so intensely it's almost psychic." },
      { trait: 'Harmonizing Nature', tagline: "You make everyone around you comfortable. Conflict dissolves in your presence." },
      { trait: 'Emotional Fluidity', tagline: "You flow with change instead of fighting it. That's a rare kind of strength." },
    ],
    shadow: [
      { trait: 'Identity Erosion', tagline: "You become whoever he needs. But who are you when no one's watching?" },
      { trait: 'People-Pleasing', tagline: "Saying yes to everyone means saying no to yourself. Every single time." },
      { trait: 'Self-Abandonment', tagline: "You disappear into relationships and call it love. It's not love — it's erasure." },
      { trait: 'Boundary Dissolution', tagline: "Where you end and he begins? You stopped knowing a long time ago." },
    ],
  },
};

// Helper to get today's duality traits
export function getDailyDuality(soulType: string): { light: DualityTrait; shadow: DualityTrait } | null {
  const duality = SOUL_TYPE_DUALITY_MAP[soulType];
  if (!duality) return null;

  const dayIndex = new Date().getDate() % 4;
  return {
    light: duality.light[dayIndex],
    shadow: duality.shadow[dayIndex],
  };
}

// Get all duality traits for a soul type
export function getAllDuality(soulType: string): SoulTypeDuality | null {
  return SOUL_TYPE_DUALITY_MAP[soulType] || null;
}
