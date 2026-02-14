import { SoulTypeMedia } from './SoulTypeMedia';

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

interface ArchetypeCardProps {
  archetype: Archetype;
}

export function ArchetypeCard({ archetype }: ArchetypeCardProps) {
  return (
    <div className="rounded-3xl overflow-hidden bg-black">
      <div className="relative" style={{ aspectRatio: '1' }}>
        <SoulTypeMedia
          src={archetype.imageUrl}
          alt={archetype.title}
          className="relative w-full h-full object-cover"
        />
        <div className="absolute top-4 left-4">
          <div
            className="text-white tracking-wider"
            style={{
              fontSize: '20px',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontWeight: 200,
              letterSpacing: '1.5px',
              textShadow: '0 2px 10px rgba(0,0,0,0.5)'
            }}
          >
            {archetype.name}
          </div>
        </div>
      </div>

      <div
        className="p-6 text-center flex flex-col items-center"
        style={{
          background: `linear-gradient(to bottom, ${archetype.gradientColors.from}, ${archetype.gradientColors.to})`
        }}
      >
        <h4 className="text-white text-xl mb-3" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          {archetype.title}
        </h4>

        <p className="text-gray-300 text-sm mb-4 leading-relaxed">
          {archetype.description}
        </p>

        <div className="flex flex-wrap gap-2 mb-5 justify-center">
          {archetype.traits.map((trait, index) => (
            <span
              key={index}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: `${archetype.traitColors[index] || archetype.gradientColors.from}CC`,
                color: 'white'
              }}
            >
              {trait}
            </span>
          ))}
        </div>

        <div className="text-xs text-white/80">
          Energy Type: {archetype.energyType}
        </div>
      </div>
    </div>
  );
}
