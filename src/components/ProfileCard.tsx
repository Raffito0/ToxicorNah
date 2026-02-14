interface ProfileCardProps {
  title: string;
  description: string;
  traits: string[];
  imageUrl?: string;
}

export function ProfileCard({ title, description, traits, imageUrl }: ProfileCardProps) {
  return (
    <div className="bg-gradient-to-b from-blue-900/30 to-black rounded-3xl p-6 border border-gray-800">
      <div className="aspect-[3/4] rounded-2xl overflow-hidden mb-4 bg-gradient-to-b from-blue-600/20 to-purple-900/40 flex items-center justify-center relative">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="text-center px-4">
            <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-400 to-purple-600 opacity-80" />
            <div className="text-white font-semibold text-sm">{title}</div>
          </div>
        )}
        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-full">
          <span className="text-white text-xs font-medium">EMOTIONAL TONE</span>
        </div>
      </div>

      <h3 className="text-white text-xl mb-3" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 200, letterSpacing: '1.5px' }}>{title}</h3>
      <p className="text-gray-400 text-sm mb-4 leading-relaxed">{description}</p>

      <div className="flex flex-wrap gap-2">
        {traits.map((trait, index) => (
          <span
            key={index}
            className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30"
          >
            {trait}
          </span>
        ))}
      </div>
    </div>
  );
}
