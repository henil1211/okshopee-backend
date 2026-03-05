import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind class merger
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format currency
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

// Format number with commas
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

// Format date
function parseValidDate(input: unknown): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (input === null || input === undefined) return null;
  const date = new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(dateInput: unknown): string {
  const date = parseValidDate(dateInput);
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

// Normalize phone number by keeping digits and optional leading +
export function normalizePhoneNumber(phoneInput: string): string {
  const trimmed = phoneInput.trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return '';
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

// Basic phone validation: allows E.164 (+XXXXXXXX) or 8-15 local/international digits
export function isValidPhoneNumber(phoneInput: string): boolean {
  const normalized = normalizePhoneNumber(phoneInput);
  if (!normalized) return false;
  const e164Like = /^\+[1-9]\d{7,14}$/;
  const digitsOnly = /^\d{8,15}$/;
  const numeric = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (/^(\d)\1+$/.test(numeric)) return false;
  return e164Like.test(normalized) || digitsOnly.test(normalized);
}

// Format relative time
export function formatRelativeTime(dateInput: unknown): string {
  const date = parseValidDate(dateInput);
  if (!date) return '-';
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return formatDate(date);
}

// Generate unique ID
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Truncate text
export function truncateText(text: string | null | undefined, maxLength: number): string {
  const value = typeof text === 'string' ? text : '';
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength) + '...';
}

// Validate email
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validate username
export function isValidUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
}

// Validate password
export function isValidPassword(password: string): boolean {
  return password.length >= 6;
}

// Calculate percentage
export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

// Debounce function
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Throttle function
export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Copy to clipboard
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}

// Download JSON data
export function downloadJSON(data: any, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Get initials from name
export function getInitials(name: string | null | undefined): string {
  const value = typeof name === 'string' && name.trim().length > 0 ? name : 'User';
  return value
    .split(' ')
    .map(n => n[0] || '')
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

// Generate avatar color based on string
export function generateAvatarColor(str: string | null | undefined): string {
  const value = typeof str === 'string' && str.length > 0 ? str : 'default';
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500'
  ];
  
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

// Calculate time remaining
export function calculateTimeRemaining(endTime: string): { hours: number; minutes: number; seconds: number } {
  const end = new Date(endTime).getTime();
  const now = new Date().getTime();
  const diff = end - now;

  if (diff <= 0) {
    return { hours: 0, minutes: 0, seconds: 0 };
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { hours, minutes, seconds };
}

// Format countdown
export function formatCountdown(time: { hours: number; minutes: number; seconds: number }): string {
  return `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:${String(time.seconds).padStart(2, '0')}`;
}

// Get level name
export function getLevelName(level: number): string {
  const levels = [
    'Starter',
    'Bronze',
    'Silver',
    'Gold',
    'Platinum',
    'Diamond',
    'Crown Diamond',
    'Royal',
    'Crown Royal',
    'Elite',
    'Legend'
  ];
  return levels[level] || `Level ${level}`;
}

// Get transaction type color
export function getTransactionTypeColor(type: string): string {
  const colors: Record<string, string> = {
    activation: 'bg-blue-500',
    income_transfer: 'bg-indigo-500',
    pin_used: 'bg-blue-500',
    direct_income: 'bg-green-500',
    level_income: 'bg-emerald-500',
    give_help: 'bg-orange-500',
    get_help: 'bg-purple-500',
    receive_help: 'bg-purple-500',
    p2p_transfer: 'bg-cyan-500',
    withdrawal: 'bg-red-500',
    reentry: 'bg-amber-500',
    safety_pool: 'bg-gray-500'
  };
  return colors[type] || 'bg-gray-500';
}

// Get transaction type icon
export function getTransactionTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    activation: 'Zap',
    income_transfer: 'ArrowRightLeft',
    pin_used: 'Zap',
    direct_income: 'UserPlus',
    level_income: 'TrendingUp',
    give_help: 'ArrowUpRight',
    get_help: 'ArrowDownLeft',
    receive_help: 'ArrowDownLeft',
    p2p_transfer: 'Repeat',
    withdrawal: 'Wallet',
    reentry: 'RefreshCw',
    safety_pool: 'Shield'
  };
  return icons[type] || 'Circle';
}

// Get transaction type display label
export function getTransactionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    activation: 'Activation',
    income_transfer: 'Income Transfer',
    pin_used: 'Activation',
    direct_income: 'Direct Income',
    level_income: 'Level Income',
    give_help: 'Give Help',
    get_help: 'Receive Help',
    receive_help: 'Receive Help',
    p2p_transfer: 'P2P Transfer',
    withdrawal: 'Withdrawal',
    reentry: 'Reentry',
    safety_pool: 'Safety Pool',
    admin_credit: 'Admin Credit',
    admin_debit: 'Admin Debit'
  };

  if (labels[type]) return labels[type];

  return type
    .split('_')
    .map(word => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// Calculate matrix position
export function calculateMatrixPosition(index: number): { row: number; col: number } {
  const row = Math.floor(Math.log2(index + 1));
  const col = index - (Math.pow(2, row) - 1);
  return { row, col };
}

// Get tree depth
export function getTreeDepth(count: number): number {
  return Math.floor(Math.log2(count)) + 1;
}

// Format bytes
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Sleep/promise delay
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Random range
export function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Random integer
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Shuffle array
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Group by
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((result, item) => {
    const groupKey = String(item[key]);
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {} as Record<string, T[]>);
}

// Deep clone
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Is object empty
export function isEmptyObject(obj: Record<string, any>): boolean {
  return Object.keys(obj).length === 0;
}

// Capitalize first letter
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Camel case to title case
export function camelToTitle(str: string): string {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

