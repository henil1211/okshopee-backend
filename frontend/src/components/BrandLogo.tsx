import { useEffect, useMemo, useState } from 'react';
import { Network } from 'lucide-react';
import { useTheme } from 'next-themes';

import { cn } from '@/lib/utils';

type BrandLogoVariant = 'icon' | 'full';
type BrandLogoTheme = 'auto' | 'light' | 'dark';

type BrandLogoProps = {
  className?: string;
  imgClassName?: string;
  alt?: string;
  variant?: BrandLogoVariant;
  theme?: BrandLogoTheme;
};

export default function BrandLogo({
  className,
  imgClassName,
  alt,
  variant = 'icon',
  theme = 'auto'
}: BrandLogoProps) {
  const { resolvedTheme } = useTheme();
  const [useSvgFallback, setUseSvgFallback] = useState(false);
  const [failed, setFailed] = useState(false);

  const effectiveTheme = theme === 'auto' ? (resolvedTheme === 'light' ? 'light' : 'dark') : theme;

  const basePath = useMemo(() => {
    if (variant === 'full') {
      return effectiveTheme === 'light' ? '/refernex-full-light' : '/refernex-full-dark';
    }
    return effectiveTheme === 'light' ? '/refernex-icon-light' : '/refernex-icon-dark';
  }, [effectiveTheme, variant]);

  const src = useMemo(() => `${basePath}.${useSvgFallback ? 'svg' : 'png'}`, [basePath, useSvgFallback]);

  useEffect(() => {
    setUseSvgFallback(false);
    setFailed(false);
  }, [basePath]);

  if (failed) {
    return (
      <span className={cn('flex items-center justify-center rounded-xl bg-gradient-primary text-white', className)}>
        <Network className={cn(variant === 'full' ? 'h-6 w-6' : 'h-5 w-5', imgClassName)} />
        {variant === 'full' && <span className="ml-2 text-sm font-semibold tracking-wide">ReferNex</span>}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex overflow-hidden rounded-xl', className)}>
      <img
        src={src}
        alt={alt || (variant === 'full' ? 'ReferNex logo' : 'ReferNex icon')}
        className={cn('h-full w-full object-contain', imgClassName)}
        onError={() => {
          if (!useSvgFallback) {
            setUseSvgFallback(true);
            return;
          }
          setFailed(true);
        }}
      />
    </span>
  );
}
