// ===== SOUL TYPES CONFIGURATION =====
// This file contains all Soul Type definitions for both male and female archetypes

// Supabase Storage base URL for Soul Type media
// Male: videos (.mp4) in soul-types/male/{Name}.mp4
// Female: images (.png) in soul-types/female/{Name}.png
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SOUL_TYPE_STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/dynamic-archetypes/soul-types`;

function soulTypeImage(gender: 'male' | 'female', name: string, side: boolean = false): string {
  const suffix = side ? '-side' : '';
  // Male normal = .mp4 video, everything else = .png image
  // Side profiles are always .png for both genders
  const ext = (gender === 'male' && !side) ? 'mp4' : 'png';
  const encoded = encodeURIComponent(`${name}${suffix}.${ext}`);
  return `${SOUL_TYPE_STORAGE_BASE}/${gender}/${encoded}`;
}

/** Check if a Soul Type media URL is a video (male Soul Types use .mp4) */
export function isSoulTypeVideo(url: string): boolean {
  return url.toLowerCase().endsWith('.mp4');
}

export interface SoulType {
  id: string;
  name: string;
  gender: 'male' | 'female';
  // Normal version - used in Soul Type Card
  normalImage: string;
  // Side profile version - used in "Your Souls Together" card
  sideProfileImage: string;
  // Description and traits
  tagline: string;
  description: string;
  traits: string[];
  // Criteria for assignment (can be expanded based on analysis logic)
  keywords?: string[];
  energyType?: string;
}

// ===== MALE SOUL TYPES (14 total) =====
export const MALE_SOUL_TYPES: SoulType[] = [
  {
    id: 'male-untamable',
    name: 'The Untamable',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Untamable'),
    sideProfileImage: soulTypeImage('male', 'The Untamable', true),
    tagline: 'Wild at heart, impossible to cage',
    description: 'He lives by his own rules. Freedom is his religion, and commitment feels like chains.',
    traits: ['Independent', 'Unpredictable', 'Magnetic'],
    keywords: ['freedom', 'wild', 'independent', 'non-committal', 'adventurous'],
    energyType: 'Wild Energy',
  },
  {
    id: 'male-gentle-flame',
    name: 'The Gentle Flame',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Gentle Flame'),
    sideProfileImage: soulTypeImage('male', 'The Gentle Flame', true),
    tagline: 'The flame that stays when storms come.',
    description: 'A steady glow in a world of wildfires. He shows up, remembers the little things, and loves without overwhelming. His warmth is constant—never burning too bright, never going out.',
    traits: ['Loyal', 'Attentive', 'Wholesome'],
    keywords: ['loyal', 'caring', 'consistent', 'sweet', 'reliable', 'warm'],
    energyType: 'Warm Energy',
  },
  {
    id: 'male-silent-abyss',
    name: 'The Silent Abyss',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Silent Abyss'),
    sideProfileImage: soulTypeImage('male', 'The Silent Abyss', true),
    tagline: 'You\'ll drown trying to reach the bottom.',
    description: 'He seems impossibly deep, mysterious, full of hidden depths. But the more you try to understand him, the more you lose yourself in the void.',
    traits: ['Mysterious', 'Unreachable', 'Enigmatic'],
    keywords: ['vague', 'undefined', 'deep', 'mysterious', 'unreachable'],
    energyType: 'Abyss Energy',
  },
  {
    id: 'male-faded-crown',
    name: 'The Faded Crown',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Faded Crown'),
    sideProfileImage: soulTypeImage('male', 'The Faded Crown', true),
    tagline: 'A king with nothing left to rule.',
    description: 'He resurfaces months later like nothing happened. Still expects the throne, still acts like royalty—but you\'ve already built a kingdom without him.',
    traits: ['Entitled', 'Nostalgic', 'Delusional'],
    keywords: ['ex', 'comes back', 'past', 'entitled', 'return', 'history', 'old flame'],
    energyType: 'Hollow Energy',
  },
  {
    id: 'male-sweet-poison',
    name: 'The Sweet Poison',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Sweet Poison'),
    sideProfileImage: soulTypeImage('male', 'The Sweet Poison', true),
    tagline: 'Tastes like love. Burns like acid.',
    description: 'Every word drips honey—the compliments, the "I miss you"s, the "you\'re the only one." But somehow you always feel smaller after talking to him. The sweetness is the trap. The poison works slow.',
    traits: ['Manipulative', 'Charming', 'Corrosive'],
    keywords: ['gaslighting', 'manipulation', 'sweet', 'toxic', 'charming', 'insidious', 'erosion'],
    energyType: 'Toxic Energy',
  },
  {
    id: 'male-wounded-prince',
    name: 'The Wounded Prince',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Wounded Prince'),
    sideProfileImage: soulTypeImage('male', 'The Wounded Prince', true),
    tagline: 'His wounds are weapons.',
    description: 'He wears his pain like armor and his trauma like a crown. Every conversation circles back to how broken he is, how much he\'s suffered. You end up apologizing for things you didn\'t do—because how dare you hurt someone who\'s already hurting?',
    traits: ['Manipulative', 'Guilt-tripping', 'Victim-playing'],
    keywords: ['guilt trip', 'victim', 'trauma card', 'emotional blackmail', 'broken', 'wounded', 'manipulation', 'pity'],
    energyType: 'Martyr Energy',
  },
  {
    id: 'male-burning-promise',
    name: 'The Burning Promise',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Burning Promise'),
    sideProfileImage: soulTypeImage('male', 'The Burning Promise', true),
    tagline: 'Soulmate energy week one. Stranger by month two.',
    description: 'Overwhelming affection from day one. Future plans, deep talks, constant attention—until suddenly he\'s gone.',
    traits: ['Intense', 'Overwhelming', 'Fast-moving'],
    keywords: ['intense', 'fast', 'overwhelming', 'future faking', 'clingy'],
    energyType: 'Explosive Energy',
  },
  {
    id: 'male-final-silence',
    name: 'The Final Silence',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Final Silence'),
    sideProfileImage: soulTypeImage('male', 'The Final Silence', true),
    tagline: 'Left on read. Left for dead.',
    description: 'No warning. No goodbye. No closure. Just the loudest silence you\'ve ever heard. He was all in—until he wasn\'t. Now you\'re left reading old texts wondering what you missed. You didn\'t miss anything. Some people just vanish.',
    traits: ['Avoidant', 'Cowardly', 'Disappearing'],
    keywords: ['ghost', 'ghosting', 'disappear', 'vanish', 'no response', 'left on read', 'blocked', 'silent', 'gone', 'no closure'],
    energyType: 'Phantom Energy',
  },
  {
    id: 'male-dark-mirror',
    name: 'The Dark Mirror',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Dark Mirror'),
    sideProfileImage: soulTypeImage('male', 'The Dark Mirror', true),
    tagline: 'His favorite topic? Himself.',
    description: 'Charming on the surface, manipulative underneath. Everything is about him, and your feelings are always overreactions.',
    traits: ['Self-absorbed', 'Manipulative', 'Gaslighting'],
    keywords: ['ego', 'selfish', 'gaslighting', 'manipulation', 'toxic', 'disrespectful', 'condescending', 'dismissive', 'degrading', 'belittling'],
    energyType: 'Toxic Energy',
  },
  {
    id: 'male-ice-charmer',
    name: 'The Ice Charmer',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Ice Charmer'),
    sideProfileImage: soulTypeImage('male', 'The Ice Charmer', true),
    tagline: 'His walls have walls.',
    description: 'He\'s physically present but emotionally checked out. Deep conversations feel like pulling teeth.',
    traits: ['Closed off', 'Distant', 'Guarded'],
    keywords: ['closed', 'unavailable', 'distant', 'walls', 'guarded'],
    energyType: 'Frozen Energy',
  },
  {
    id: 'male-silent-choke',
    name: 'The Silent Choke',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Silent Choke'),
    sideProfileImage: soulTypeImage('male', 'The Silent Choke', true),
    tagline: 'First he wants you. Then he owns you.',
    description: 'It starts with "I just want you all to myself." Cute at first. Then the grip tightens. He needs to know where you are, who you\'re with, why you didn\'t text back in three minutes. Love becomes surveillance. Affection becomes control. By the time you notice, you can barely breathe.',
    traits: ['Possessive', 'Controlling', 'Jealous'],
    keywords: ['possessive', 'jealous', 'controlling', 'checking phone', 'isolating', 'clingy', 'suffocating', 'where were you', 'who was that', 'my girl', 'mine', 'threatening', 'aggressive', 'intimidating', 'harassing', 'stalking', 'objectifying', 'vulgar', 'creepy', 'abusive'],
    energyType: 'Constrictor Energy',
  },
  {
    id: 'male-shifting-flame',
    name: 'The Shifting Flame',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Shifting Flame'),
    sideProfileImage: soulTypeImage('male', 'The Shifting Flame', true),
    tagline: 'Hot until he\'s not.',
    description: 'Monday he\'s all over you—texts, calls, plans. By Wednesday? Radio silence. You spend more time decoding his mood than enjoying his company. The heat is addictive, but it always fades. And you\'re left wondering what you did wrong. You didn\'t do anything. He just runs hot and cold.',
    traits: ['Inconsistent', 'Confusing', 'Unpredictable'],
    keywords: ['hot and cold', 'inconsistent', 'mixed signals', 'confusing', 'one minute', 'mood swings', 'unpredictable', 'back and forth', 'sometimes'],
    energyType: 'Unstable Energy',
  },
  {
    id: 'male-chameleon',
    name: 'The Chameleon',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Chameleon'),
    sideProfileImage: soulTypeImage('male', 'The Chameleon', true),
    tagline: 'A different man for every woman.',
    description: 'He morphs into your perfect match—your humor, your music taste, your dreams. But it\'s all performance. Under the painted skin, there\'s no one home. When you finally see the real him, you realize: there is no real him.',
    traits: ['Adaptive', 'Identity-less', 'Performative'],
    keywords: ['chameleon', 'fake', 'no identity', 'changes', 'adapts', 'mirror', 'becomes', 'different person', 'acts'],
    energyType: 'Shapeshifter Energy',
  },
  {
    id: 'male-star-collector',
    name: 'The Star Collector',
    gender: 'male',
    normalImage: soulTypeImage('male', 'The Star Collector'),
    sideProfileImage: soulTypeImage('male', 'The Star Collector', true),
    tagline: 'One of many. Never the one.',
    description: 'He gathers admirers like constellations—always adding, never choosing. You thought you were special until you realized you\'re just another star in his sky. He keeps you around, keeps you hoping, but his heart? Always orbiting someone else.',
    traits: ['Noncommittal', 'Options-obsessed', 'Second-choice maker'],
    keywords: ['backup', 'second choice', 'options', 'not priority', 'never first', 'alternative', 'plan B', 'waiting', 'stringing along'],
    energyType: 'Collector Energy',
  },
];

// ===== FEMALE SOUL TYPES (16 total) =====
export const FEMALE_SOUL_TYPES: SoulType[] = [
  {
    id: 'female-love-rush',
    name: 'The Love Rush',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Love Rush'),
    sideProfileImage: soulTypeImage('female', 'The Love Rush', true),
    tagline: 'Ready to love before hello.',
    description: 'She doesn\'t walk into love—she sprints. One kind text and she\'s already picturing the wedding. Her heart has no speed limit, no brakes, no caution signs. She catches feelings like other people catch colds: fast, hard, and with no warning. Is it too much? Maybe. But she\'d rather feel everything than feel nothing.',
    traits: ['Hopeless romantic', 'Fast-falling', 'All heart'],
    keywords: ['catches feelings', 'falls fast', 'too quick', 'hopeless romantic', 'all in', 'love fast', 'feelings first', 'no chill', 'heart first', 'attached'],
    energyType: 'Rush Energy',
  },
  {
    id: 'female-natural-state',
    name: 'The Natural State',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Natural State'),
    sideProfileImage: soulTypeImage('female', 'The Natural State', true),
    tagline: 'She is who she is.',
    description: 'No masks, no performances, no pretending to be someone she\'s not. She shows up exactly as she is—raw, real, and completely unbothered by what anyone thinks. In a world of filters, she\'s the unedited version. Take her or leave her, but don\'t ask her to change.',
    traits: ['Authentic', 'Grounded', 'Unapologetic'],
    keywords: ['authentic', 'real', 'genuine', 'no filter', 'natural', 'true self', 'grounded', 'honest', 'raw', 'unfiltered', 'caring', 'warm', 'friendly', 'consistent', 'kind'],
    energyType: 'Earth Energy',
  },
  {
    id: 'female-fire-dance',
    name: 'The Fire Dance',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Fire Dance'),
    sideProfileImage: soulTypeImage('female', 'The Fire Dance', true),
    tagline: 'Born to burn.',
    description: 'She doesn\'t know how to love softly—and she doesn\'t want to learn. Everything she feels, she feels at full volume. Her passion is a wildfire: beautiful, consuming, impossible to control. She\'ll set your world on fire and dance in the flames.',
    traits: ['Passionate', 'Intense', 'All-consuming'],
    keywords: ['passionate', 'intense', 'fire', 'burns', 'all in', 'obsessive', 'feels deeply', 'too much', 'wild', 'consuming'],
    energyType: 'Fire Energy',
  },
  {
    id: 'female-frozen-bloom',
    name: 'The Frozen Bloom',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Frozen Bloom'),
    sideProfileImage: soulTypeImage('female', 'The Frozen Bloom', true),
    tagline: 'Walls up. Heart locked.',
    description: 'She\'s beautiful—stunning, even. But getting close? Impossible. Every layer you peel back reveals another wall. She learned the hard way that trusting people gets you hurt, so she stopped. Now she blooms alone, frozen in place, gorgeous but untouchable.',
    traits: ['Guarded', 'Emotionally unavailable', 'Self-protective'],
    keywords: ['trust issues', 'walls', 'guarded', 'emotionally unavailable', 'cold', 'distant', 'frozen', 'closed off', 'won\'t let you in', 'hurt before', 'cautious', 'defensive', 'wary', 'skeptical', 'suspicious', 'careful', 'protecting'],
    energyType: 'Frost Energy',
  },
  {
    id: 'female-torn-silk',
    name: 'The Torn Silk',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Torn Silk'),
    sideProfileImage: soulTypeImage('female', 'The Torn Silk', true),
    tagline: 'Cracked, not shattered.',
    description: 'She carries the marks of everything she\'s been through—every heartbreak, every betrayal, every tear. But she\'s still here. Still soft. Still standing. Her damage isn\'t her downfall; it\'s her proof of survival. Broken? Maybe. But never destroyed.',
    traits: ['Resilient', 'Vulnerable', 'Elegant'],
    keywords: ['broken', 'damaged', 'torn', 'cracked', 'elegant', 'survived', 'scars', 'still standing', 'fragile', 'strong'],
    energyType: 'Silk Energy',
  },
  {
    id: 'female-inner-voice',
    name: 'The Inner Voice',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Inner Voice'),
    sideProfileImage: soulTypeImage('female', 'The Inner Voice', true),
    tagline: 'Her own guide.',
    description: 'She stopped looking for answers in other people and started trusting the light inside. Her intuition speaks—and she finally listens. No more second-guessing, no more waiting for permission. She leads herself now.',
    traits: ['Intuitive', 'Self-trusting', 'Grounded'],
    keywords: ['intuition', 'trust', 'inner voice', 'gut feeling', 'self-trust', 'guide', 'instinct', 'knows', 'listens', 'self', 'inquisitive', 'questioning', 'curious', 'investigative'],
    energyType: 'Intuitive Energy',
  },
  {
    id: 'female-silent-venom',
    name: 'The Silent Venom',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Silent Venom'),
    sideProfileImage: soulTypeImage('female', 'The Silent Venom', true),
    tagline: 'The sweetest toxin.',
    description: 'She doesn\'t scream, doesn\'t fight, doesn\'t make a scene. She just smiles—and lets the poison do its work. By the time you realize what happened, she\'s already gone. And you? You\'re still wondering why everything hurts.',
    traits: ['Toxic', 'Subtle', 'Dangerous'],
    keywords: ['toxic', 'poison', 'venom', 'subtle', 'manipulative', 'silent', 'dangerous', 'sweet', 'deadly', 'snake'],
    energyType: 'Venom Energy',
  },
  {
    id: 'female-sunset-soul',
    name: 'The Sunset Soul',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Sunset Soul'),
    sideProfileImage: soulTypeImage('female', 'The Sunset Soul', true),
    tagline: 'She gives until there\'s nothing left.',
    description: 'She pours herself into everyone she loves—her warmth, her time, her whole heart. Beautiful and golden, she glows for others until she fades. And when she\'s empty? They\'ve already moved on to the next sunrise.',
    traits: ['Giving', 'Self-sacrificing', 'Warm'],
    keywords: ['gives too much', 'selfless', 'burn out', 'empty', 'too much love', 'fades', 'warmth', 'sacrifices', 'pours out', 'exhausted'],
    energyType: 'Sunset Energy',
  },
  {
    id: 'female-deep-shadow',
    name: 'The Deep Shadow',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Deep Shadow'),
    sideProfileImage: soulTypeImage('female', 'The Deep Shadow', true),
    tagline: 'Not everyone deserves her light.',
    description: 'She carries depths most will never see. Mysterious by nature, guarded by choice. She\'s not cold—she\'s selective. Her light exists, but it\'s reserved for those who\'ve earned the right to witness it. Everyone else gets the shadow.',
    traits: ['Mysterious', 'Guarded', 'Selective'],
    keywords: ['mysterious', 'deep', 'shadow', 'guarded', 'dark', 'hidden', 'reserved', 'selective', 'private', 'enigma'],
    energyType: 'Shadow Energy',
  },
  {
    id: 'female-wild-luxury',
    name: 'The Wild Luxury',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Wild Luxury'),
    sideProfileImage: soulTypeImage('female', 'The Wild Luxury', true),
    tagline: 'Spoiled and untamed.',
    description: 'She wants the finer things—but she\'ll never be tamed for them. Designer taste meets feral instincts. She\'ll take the champagne and the chaos, the diamonds and the drama. You can spoil her, but you\'ll never own her.',
    traits: ['Luxurious', 'Untamed', 'Unapologetic'],
    keywords: ['luxury', 'spoiled', 'wild', 'expensive', 'high maintenance', 'untamed', 'bougie', 'feral', 'wants it all'],
    energyType: 'Luxe Energy',
  },
  {
    id: 'female-living-maze',
    name: 'The Living Maze',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Living Maze'),
    sideProfileImage: soulTypeImage('female', 'The Living Maze', true),
    tagline: 'A beautiful place to get lost.',
    description: 'Her mind is a labyrinth of color and chaos—stunning to look at, impossible to navigate. She thinks in spirals, feels in waves, and gets lost in her own depths. Loving her means wandering her halls forever, never quite finding the center.',
    traits: ['Overthinking', 'Complex', 'Beautifully chaotic'],
    keywords: ['overthink', 'spiral', 'lost', 'maze', 'complex', 'chaotic', 'deep', 'anxious', 'mind', 'thoughts'],
    energyType: 'Labyrinth Energy',
  },
  {
    id: 'female-golden-rule',
    name: 'The Golden Rule',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Golden Rule'),
    sideProfileImage: soulTypeImage('female', 'The Golden Rule', true),
    tagline: 'Her rules. Her terms.',
    description: 'She knows exactly what she\'s worth—and she won\'t negotiate. Standards aren\'t negotiable, boundaries aren\'t suggestions, and "good enough" isn\'t in her vocabulary. You either rise to meet her or you watch her walk.',
    traits: ['Confident', 'Uncompromising', 'High-value'],
    keywords: ['standards', 'worth', 'rules', 'terms', 'high value', 'confident', 'self-worth', 'boundaries', 'won\'t settle', 'non-negotiable', 'assertive', 'firm', 'direct', 'standing up', 'setting boundaries'],
    energyType: 'Gold Energy',
  },
  {
    id: 'female-savage-grace',
    name: 'The Savage Grace',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Savage Grace'),
    sideProfileImage: soulTypeImage('female', 'The Savage Grace', true),
    tagline: 'Grace with claws.',
    description: 'Elegant on the outside, feral underneath. She moves through life like a predator in silk—beautiful, poised, and absolutely lethal when crossed. Men think she\'s decorative until she reminds them she\'s the one doing the choosing.',
    traits: ['Fierce', 'Elegant', 'Untamed'],
    keywords: ['fierce', 'wild', 'predator', 'elegant', 'grace', 'claws', 'dangerous', 'untamed', 'hunter', 'savage'],
    energyType: 'Predator Energy',
  },
  {
    id: 'female-quiet-storm',
    name: 'The Quiet Storm',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Quiet Storm'),
    sideProfileImage: soulTypeImage('female', 'The Quiet Storm', true),
    tagline: 'Calm until she\'s not.',
    description: 'She doesn\'t raise her voice. She doesn\'t argue. She just watches, listens, and remembers everything. And when she\'s done? She\'s gone. No drama, no warning—just the door closing behind her. The loudest thing about her is her silence.',
    traits: ['Composed', 'Observant', 'Decisive'],
    keywords: ['calm', 'quiet', 'storm', 'patient', 'composed', 'still waters', 'serene', 'observes', 'walks away', 'done', 'shocked', 'disgusted', 'unbothered', 'over it'],
    energyType: 'Storm Energy',
  },
  {
    id: 'female-rising-phoenix',
    name: 'The Rising Phoenix',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Rising Phoenix'),
    sideProfileImage: soulTypeImage('female', 'The Rising Phoenix', true),
    tagline: 'Built from what broke her.',
    description: 'She burned down to ashes—and rose even brighter. Every heartbreak became fuel, every betrayal became strength. She didn\'t just survive, she transformed. And now? She\'s untouchable.',
    traits: ['Resilient', 'Transformed', 'Powerful'],
    keywords: ['phoenix', 'rise', 'ashes', 'transformed', 'heartbreak', 'stronger', 'rebuild', 'survivor', 'powerful', 'comeback'],
    energyType: 'Phoenix Energy',
  },
  {
    id: 'female-liquid-mirror',
    name: 'The Liquid Mirror',
    gender: 'female',
    normalImage: soulTypeImage('female', 'The Liquid Mirror'),
    sideProfileImage: soulTypeImage('female', 'The Liquid Mirror', true),
    tagline: 'She disappears into him.',
    description: 'She molds herself to fit whoever she\'s with. His music becomes her music. His friends become her friends. His dreams replace hers. She thinks it\'s love, but it\'s erasure. By the time she realizes she\'s lost herself, she can\'t remember who she was before him.',
    traits: ['Adaptive', 'Self-erasing', 'Identity-fluid'],
    keywords: ['adapts', 'changes for him', 'loses herself', 'mirrors', 'no identity', 'becomes him', 'shapeshifts', 'people pleaser', 'disappears', 'erased'],
    energyType: 'Mirror Energy',
  },
];

// ===== HELPER FUNCTIONS =====

export function getMaleSoulTypeById(id: string): SoulType | undefined {
  return MALE_SOUL_TYPES.find(st => st.id === id);
}

export function getFemaleSoulTypeById(id: string): SoulType | undefined {
  return FEMALE_SOUL_TYPES.find(st => st.id === id);
}

// Get any Soul Type by ID (searches both male and female)
export function getSoulTypeById(id: string): SoulType | null {
  return getMaleSoulTypeById(id) || getFemaleSoulTypeById(id) || null;
}

export function getMaleSoulTypeByName(name: string): SoulType | undefined {
  return MALE_SOUL_TYPES.find(st => st.name.toLowerCase() === name.toLowerCase());
}

export function getFemaleSoulTypeByName(name: string): SoulType | undefined {
  return FEMALE_SOUL_TYPES.find(st => st.name.toLowerCase() === name.toLowerCase());
}

// Get all Soul Types
export function getAllSoulTypes(): SoulType[] {
  return [...MALE_SOUL_TYPES, ...FEMALE_SOUL_TYPES];
}

// Get Soul Types by gender
export function getSoulTypesByGender(gender: 'male' | 'female'): SoulType[] {
  return gender === 'male' ? MALE_SOUL_TYPES : FEMALE_SOUL_TYPES;
}
