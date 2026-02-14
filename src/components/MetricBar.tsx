import { useEffect, useState } from 'react';

interface MetricBarProps {
  label: string;
  value: number;
  color: string;
  maxValue?: number;
  delay?: number;
}

export function MetricBar({ label, value, color, maxValue = 100, delay = 0 }: MetricBarProps) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const duration = 1000;
      const steps = 30;
      const increment = value / steps;
      let current = 0;

      const interval = setInterval(() => {
        current += increment;
        if (current >= value) {
          setAnimatedValue(value);
          clearInterval(interval);
        } else {
          setAnimatedValue(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  const gradientMap: Record<string, string> = {
    pink: 'linear-gradient(90deg, #db2777 0%, #f472b6 100%)',
    green: 'linear-gradient(90deg, #16a34a 0%, #4ade80 100%)',
    red: 'linear-gradient(90deg, #b91c1c 0%, #f87171 100%)',
    blue: 'linear-gradient(90deg, #1d4ed8 0%, #60a5fa 100%)',
    yellow: 'linear-gradient(90deg, #d97706 0%, #fcd34d 100%)',
    orange: 'linear-gradient(90deg, #c2410c 0%, #fb923c 100%)'
  };

  const actualGradient = gradientMap[color] || `linear-gradient(90deg, ${color} 0%, ${color} 100%)`;

  return (
    <div className="flex items-center gap-4 mb-3">
      <span className="text-sm text-white w-32 flex-shrink-0">{label}</span>
      <div className="flex-1 relative h-2">
        <div className="absolute inset-0 bg-gray-900 rounded-full" />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${(animatedValue / maxValue) * 100}%`,
            background: actualGradient
          }}
        />
      </div>
      <span className="text-sm font-semibold w-12 text-right flex-shrink-0 text-white">
        {animatedValue}%
      </span>
    </div>
  );
}
