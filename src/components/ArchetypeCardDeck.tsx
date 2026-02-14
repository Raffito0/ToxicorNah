import { ArchetypeCard } from './ArchetypeCard';

interface Archetype {
  name: string;
  title: string;
  description: string;
  traits: string[];
  traitColors: string[];
  energyType: string;
  imageUrl: string;
  gradientColors: {
    from: string;
    to: string;
  };
}

interface ArchetypeCardDeckProps {
  analysisId?: string;
}

export function ArchetypeCardDeck({ analysisId }: ArchetypeCardDeckProps) {
  const personArchetype: Archetype = {
    name: 'ANJARI',
    title: 'The Dawn Listener',
    description: 'Cool on the surface, calculated with words, but uses emotional distance as control.',
    traits: ['Soft Chaos', 'Reserved', 'Strategic'],
    traitColors: ['#F75221', '#E01F01', '#E0B118'],
    energyType: 'Cool Rational',
    imageUrl: '/openart-image_dcwh5KPN_1763106498150_raw copy.jpg',
    gradientColors: {
      from: '#190d01',
      to: '#3e1101'
    }
  };

  const userArchetype: Archetype = {
    name: 'MANNI',
    title: 'The Ice Charmer',
    description: 'Cool on the surface, calculated with words, but uses emotional distance as control.',
    traits: ['Analytical', 'Reserved', 'Strategic'],
    traitColors: ['#2A9D8F', '#1B5B54', '#3ABAA8'],
    energyType: 'Warm Emotional',
    imageUrl: '/openart-image_Hrq8vg71_1763113932943_raw.png',
    gradientColors: {
      from: '#2A9D8F',
      to: '#7DDDD0'
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <p className="text-white/50 uppercase tracking-widest mb-2" style={{ letterSpacing: '0.15em', fontSize: '16px' }}>
          Relationship Archetypes
        </p>
        <h2 className="text-white text-3xl font-bold mb-2">
          Who You Are Together
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
        <div>
          <div className="text-white/70 text-sm mb-4 text-center">He is...</div>
          <ArchetypeCard archetype={personArchetype} />
        </div>

        <div>
          <div className="text-white/70 text-sm mb-4 text-center">You are...</div>
          <ArchetypeCard archetype={userArchetype} />
        </div>
      </div>
    </div>
  );
}
