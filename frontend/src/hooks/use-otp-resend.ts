import { useCallback, useEffect, useMemo, useState } from 'react';

export function useOtpResend(cooldownSeconds: number = 30) {
  const [nextAllowedAtMs, setNextAllowedAtMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const remainingSeconds = useMemo(() => {
    return Math.max(0, Math.ceil((nextAllowedAtMs - nowMs) / 1000));
  }, [nextAllowedAtMs, nowMs]);

  const isCoolingDown = remainingSeconds > 0;

  useEffect(() => {
    if (!isCoolingDown) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isCoolingDown]);

  const startCooldown = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    setNextAllowedAtMs(now + Math.max(5, cooldownSeconds) * 1000);
  }, [cooldownSeconds]);

  const resetCooldown = useCallback(() => {
    setNowMs(Date.now());
    setNextAllowedAtMs(0);
  }, []);

  return {
    isCoolingDown,
    remainingSeconds,
    startCooldown,
    resetCooldown
  };
}
