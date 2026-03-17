import { TIER_COLORS } from '../../constants/theme';

interface TierBadgeProps {
  tierNumber: number;
  size?: 'sm' | 'md';
}

export default function TierBadge({ tierNumber, size = 'md' }: TierBadgeProps) {
  const tier = TIER_COLORS[tierNumber - 1];
  if (!tier) return null;

  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  return (
    <span className={`inline-flex items-center rounded-full font-semibold ${tier.bg} ${tier.text} ${sizeClasses}`}>
      T{tierNumber}
    </span>
  );
}
