/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Temporarily hide theme toggle (can re-enable later by removing this)
  if (!mounted) return null;
  return null;

  const isDark = !mounted || resolvedTheme !== "light";
  const nextTheme = isDark ? "light" : "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
      className="fixed right-4 bottom-24 z-[70] h-11 w-11 rounded-full border border-[#0f5fa8]/25 bg-white/85 text-[#0b1736] shadow-[0_12px_24px_rgba(12,72,144,0.2)] backdrop-blur-md hover:bg-[#eaf3ff] dark:border-white/20 dark:bg-[#111827]/85 dark:text-white dark:shadow-lg dark:hover:bg-[#1f2937] md:bottom-4"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
