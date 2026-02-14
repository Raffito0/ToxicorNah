import { FlipCard } from './FlipCard';

interface EmotionalProfile {
  card_number: number;
  category: string;
  archetype_name: string;
  description: string;
  traits: string[];
  back_title: string;
}

interface EmotionalProfileCardProps {
  profile: EmotionalProfile;
}

export function EmotionalProfileCard({ profile }: EmotionalProfileCardProps) {
  const front = (
    <div className="h-full rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 p-6 flex flex-col justify-between">
      <div>
        <div className="text-xs uppercase tracking-wider text-violet-400 mb-2">
          {profile.category}
        </div>
        <h3 className="text-xl text-white mb-3" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>
          {profile.archetype_name}
        </h3>
        <p className="text-gray-400 text-sm leading-relaxed">
          {profile.description}
        </p>
      </div>
      <div className="text-xs text-gray-500 flex items-center gap-2">
        <span>Tap to reveal</span>
        <span className="text-violet-400">→</span>
      </div>
    </div>
  );

  const back = (
    <div className="h-full rounded-2xl bg-gradient-to-br from-violet-900/50 to-pink-900/50 border border-violet-500/30 p-6 flex flex-col">
      <div className="text-xs uppercase tracking-wider text-violet-300 mb-4">
        {profile.back_title}
      </div>
      <div className="flex-1 space-y-2">
        {profile.traits.map((trait, index) => (
          <div
            key={index}
            className="flex items-center gap-2 text-sm text-gray-200"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            {trait}
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 flex items-center gap-2">
        <span>Tap to return</span>
        <span className="text-violet-400">←</span>
      </div>
    </div>
  );

  return <FlipCard front={front} back={back} className="w-72 h-52 flex-shrink-0 snap-center" />;
}
