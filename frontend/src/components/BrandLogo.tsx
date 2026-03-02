import { useState } from 'react';
import { Network } from 'lucide-react';

import { cn } from '@/lib/utils';

type BrandLogoProps = {
  className?: string;
  imgClassName?: string;
  alt?: string;
};

export default function BrandLogo({
  className,
  imgClassName,
  alt = 'ReferNex logo'
}: BrandLogoProps) {
  const [source, setSource] = useState<'png' | 'svg' | 'fallback'>('png');

  if (source === 'fallback') {
    return (
      <span className={cn('flex items-center justify-center rounded-xl bg-gradient-primary text-white', className)}>
        <Network className={cn('h-5 w-5', imgClassName)} />
      </span>
    );
  }

  const src = source === 'png' ? '/brand-logo.png' : '/brand-logo.svg';

  return (
    <span className={cn('inline-flex overflow-hidden rounded-xl', className)}>
      <img
        src={src}
        alt={alt}
        className={cn('h-full w-full object-cover', imgClassName)}
        onError={() => {
          if (source === 'png') {
            setSource('svg');
            return;
          }
          setSource('fallback');
        }}
      />
    </span>
  );
}
