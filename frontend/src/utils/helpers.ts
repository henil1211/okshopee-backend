import { clsx, type ClassValue } from 'clsx';
import { getCountryCallingCode, isValidPhoneNumber as isValidPhoneNumberLib, type CountryCode } from 'libphonenumber-js';
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
export function normalizePhoneNumber(phoneInput?: string | null): string {
  const trimmed = String(phoneInput ?? '').trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return '';
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

const COUNTRY_NAME_ALIASES: Record<string, string> = {
  usa: 'United States',
  us: 'United States',
  'u.s.a': 'United States',
  'u.s': 'United States',
  uk: 'United Kingdom',
  'u.k': 'United Kingdom',
  england: 'United Kingdom',
  uae: 'UAE',
  'united arab emirates': 'UAE',
  'saudi arabia': 'Saudi Arabia',
  'south korea': 'South Korea',
  korea: 'South Korea'
};

function normalizeCountryName(countryName?: string | null): string {
  const raw = String(countryName ?? '').trim();
  if (!raw) return '';
  const alias = COUNTRY_NAME_ALIASES[raw.toLowerCase()];
  return alias || raw;
}

const COUNTRY_NAME_TO_CODE: Record<string, CountryCode> = {
  'United States': 'US',
  'United Kingdom': 'GB',
  'Canada': 'CA',
  'Australia': 'AU',
  'Germany': 'DE',
  'France': 'FR',
  'India': 'IN',
  'Pakistan': 'PK',
  'Nigeria': 'NG',
  'South Africa': 'ZA',
  'Brazil': 'BR',
  'Mexico': 'MX',
  'China': 'CN',
  'Japan': 'JP',
  'South Korea': 'KR',
  'Singapore': 'SG',
  'Malaysia': 'MY',
  'Indonesia': 'ID',
  'Philippines': 'PH',
  'Thailand': 'TH',
  'Vietnam': 'VN',
  'UAE': 'AE',
  'Saudi Arabia': 'SA'
};

const COUNTRY_NAME_TO_CURRENCY: Record<string, string> = {
  'United States': 'USD',
  'United Kingdom': 'GBP',
  'Canada': 'CAD',
  'Australia': 'AUD',
  'Germany': 'EUR',
  'France': 'EUR',
  'India': 'INR',
  'Pakistan': 'PKR',
  'Nigeria': 'NGN',
  'South Africa': 'ZAR',
  'Brazil': 'BRL',
  'Mexico': 'MXN',
  'China': 'CNY',
  'Japan': 'JPY',
  'South Korea': 'KRW',
  'Singapore': 'SGD',
  'Malaysia': 'MYR',
  'Indonesia': 'IDR',
  'Philippines': 'PHP',
  'Thailand': 'THB',
  'Vietnam': 'VND',
  'UAE': 'AED',
  'Saudi Arabia': 'SAR'
};

export function getCountryCodeFromName(countryName?: string | null): CountryCode | undefined {
  const normalizedCountry = normalizeCountryName(countryName);
  if (!normalizedCountry) return undefined;
  return COUNTRY_NAME_TO_CODE[normalizedCountry];
}

export function getDialCodeForCountry(countryName?: string | null): string | null {
  const code = getCountryCodeFromName(countryName);
  if (!code) return null;
  return `+${getCountryCallingCode(code)}`;
}

export function getCurrencyCodeForCountry(countryName?: string | null): string | null {
  const normalizedCountry = normalizeCountryName(countryName);
  if (!normalizedCountry) return null;
  return COUNTRY_NAME_TO_CURRENCY[normalizedCountry] || null;
}

export function getCurrencyLabelForCountry(countryName?: string | null): string | null {
  const currencyCode = getCurrencyCodeForCountry(countryName);
  if (!currencyCode) return null;
  try {
    const currencyPart = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).formatToParts(1).find(part => part.type === 'currency')?.value;

    if (currencyPart && currencyPart !== currencyCode) {
      return `${currencyPart} ${currencyCode}`;
    }
  } catch {
    // Ignore formatter issues and fall back to code.
  }
  return currencyCode;
}

export function formatAmountForCountryCurrency(amount: number, countryName?: string | null): string {
  const currencyCode = getCurrencyCodeForCountry(countryName);
  if (!currencyCode) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  const padding = (base64.match(/=*$/)?.[0].length || 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = src;
  });
}

export async function readOptimizedUploadDataUrl(
  file: File,
  options?: {
    maxDimension?: number;
    targetBytes?: number;
    quality?: number;
  }
): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file);

  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return originalDataUrl;
  }

  const maxDimension = Math.max(600, Number(options?.maxDimension ?? 1600));
  const targetBytes = Math.max(150 * 1024, Number(options?.targetBytes ?? 700 * 1024));
  const startingQuality = Math.min(0.92, Math.max(0.55, Number(options?.quality ?? 0.86)));

  try {
    const image = await loadImageElement(originalDataUrl);
    const largestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
    const initialScale = largestSide > maxDimension ? maxDimension / largestSide : 1;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return originalDataUrl;

    const qualitySteps = [startingQuality, 0.8, 0.72, 0.64, 0.58];
    let scale = initialScale;
    let bestDataUrl = originalDataUrl;
    let bestSize = estimateDataUrlSizeBytes(originalDataUrl);

    for (let scaleStep = 0; scaleStep < 3; scaleStep += 1) {
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      canvas.width = width;
      canvas.height = height;

      context.clearRect(0, 0, width, height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        const candidateSize = estimateDataUrlSizeBytes(candidate);
        if (candidateSize < bestSize) {
          bestDataUrl = candidate;
          bestSize = candidateSize;
        }
        if (candidateSize <= targetBytes) {
          return candidateSize < estimateDataUrlSizeBytes(originalDataUrl) ? candidate : originalDataUrl;
        }
      }

      scale *= 0.82;
    }

    return bestSize < estimateDataUrlSizeBytes(originalDataUrl) ? bestDataUrl : originalDataUrl;
  } catch {
    return originalDataUrl;
  }
}

const BACKEND_UPLOAD_BASE_URL = (
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL || 'http://localhost:4000'
).replace(/\/+$/, '');

export async function uploadDataUrlToBackend(params: {
  scope: string;
  fileName: string;
  dataUrl: string;
  mimeType?: string;
}): Promise<{
  fileUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const response = await fetch(`${BACKEND_UPLOAD_BASE_URL}/api/upload-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: params.scope,
      fileName: params.fileName,
      mimeType: params.mimeType,
      dataUrl: params.dataUrl
    })
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || payload?.ok === false || typeof payload?.fileUrl !== 'string') {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Failed to upload file (HTTP ${response.status})`;
    throw new Error(message);
  }

  return {
    fileUrl: payload.fileUrl,
    fileName: typeof payload?.fileName === 'string' ? payload.fileName : params.fileName,
    mimeType: typeof payload?.mimeType === 'string' ? payload.mimeType : (params.mimeType || ''),
    sizeBytes: Number(payload?.sizeBytes || 0) || 0
  };
}

export async function uploadOptimizedFileToBackend(
  file: File,
  params: {
    scope: string;
    maxDimension?: number;
    targetBytes?: number;
    quality?: number;
  }
): Promise<{
  fileUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const dataUrl = await readOptimizedUploadDataUrl(file, {
    maxDimension: params.maxDimension,
    targetBytes: params.targetBytes,
    quality: params.quality
  });

  return uploadDataUrlToBackend({
    scope: params.scope,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    dataUrl
  });
}

// Basic phone validation: allows E.164 (+XXXXXXXX) or 8-15 local/international digits
export function isValidPhoneNumber(phoneInput?: string | null): boolean {
  const normalized = normalizePhoneNumber(phoneInput);
  if (!normalized) return false;
  const e164Like = /^\+[1-9]\d{7,14}$/;
  const digitsOnly = /^\d{8,15}$/;
  const numeric = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (/^(\d)\1+$/.test(numeric)) return false;
  return e164Like.test(normalized) || digitsOnly.test(normalized);
}

export function isValidPhoneNumberForCountry(phoneInput?: string | null, countryName?: string | null): boolean {
  const countryCode = getCountryCodeFromName(countryName);
  if (countryCode) {
    return isValidPhoneNumberLib(String(phoneInput ?? ''), countryCode);
  }
  return isValidPhoneNumber(phoneInput);
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

// Validate login password (min 8, upper, lower, number, special)
export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password)
  );
}

export function getPasswordRequirementsText(): string {
  return 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
}

// Validate transaction password (PIN-style)
export function isValidTransactionPassword(password: string): boolean {
  return /^\d{4,6}$/.test(password);
}

export function getTransactionPasswordRequirementsText(): string {
  return 'Transaction password must be 4-6 digits.';
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

// Calculate time remaining with days
export function calculateTimeRemainingWithDays(endTime: string): {
  days: number; hours: number; minutes: number; seconds: number; expired: boolean;
} {
  const end = new Date(endTime).getTime();
  const now = new Date().getTime();
  const diff = end - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds, expired: false };
}

// Format countdown with days
export function formatCountdownWithDays(time: { days: number; hours: number; minutes: number; seconds: number }): string {
  return `${String(time.days).padStart(2, '0')}:${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:${String(time.seconds).padStart(2, '0')}`;
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
    royalty_transfer: 'bg-amber-500',
    pin_used: 'bg-blue-500',
    direct_income: 'bg-green-500',
    level_income: 'bg-emerald-500',
    royalty_income: 'bg-amber-500',
    give_help: 'bg-orange-500',
    get_help: 'bg-purple-500',
    receive_help: 'bg-purple-500',
    p2p_transfer: 'bg-cyan-500',
    withdrawal: 'bg-red-500',
    fund_recovery: 'bg-amber-500',
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
    royalty_transfer: 'ArrowRightLeft',
    pin_used: 'Zap',
    direct_income: 'UserPlus',
    level_income: 'TrendingUp',
    royalty_income: 'Award',
    give_help: 'ArrowUpRight',
    get_help: 'ArrowDownLeft',
    receive_help: 'ArrowDownLeft',
    p2p_transfer: 'Repeat',
    withdrawal: 'Wallet',
    fund_recovery: 'RotateCcw',
    reentry: 'RefreshCw',
    safety_pool: 'Shield'
  };
  return icons[type] || 'Circle';
}

// Get transaction type display label
export function getTransactionTypeLabel(type: string, description?: string): string {
  const normalizedDescription = String(description || '').toLowerCase();
  const isInternalTransfer =
    (type === 'income_transfer' || type === 'royalty_transfer' || type === 'p2p_transfer')
    && (
      normalizedDescription.includes('to your fund wallet')
      || normalizedDescription.includes('to your income wallet')
      || normalizedDescription.includes('credited from your income wallet transfer')
      || normalizedDescription.includes('credited from your royalty wallet transfer')
    );

  if (isInternalTransfer) return 'Internal Transfer';

  const labels: Record<string, string> = {
    activation: 'Activation',
    income_transfer: 'Income Transfer',
    royalty_transfer: 'Royalty Transfer',
    pin_used: 'Activation',
    direct_income: 'Referral Income',
    level_income: 'Level Income',
    royalty_income: 'Royalty Income',
    give_help: 'Give Help',
    get_help: 'Receive Help',
    receive_help: 'Receive Help',
    p2p_transfer: 'P2P Transfer',
    withdrawal: 'Withdrawal',
    reentry: 'Reentry',
    safety_pool: 'Safety Pool',
    admin_credit: 'Admin Credit',
    admin_debit: 'Admin Debit',
    fund_recovery: 'Fund Recovery',
    system_fee: 'System Fee'
  };

  if (labels[type]) return labels[type];

  return type
    .split('_')
    .map(word => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function getVisibleTransactionDescription(description: string | undefined): string {
  return String(description || '')
    .replace(/\s*\[Redemption:[^\]]+\]\s*/g, ' ')
    .replace(/Direct sponsor income/gi, 'Referral income')
    .replace(/No sponsor - direct income/gi, 'No sponsor - referral income')
    .trim();
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

