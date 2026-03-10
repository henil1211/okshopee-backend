// User Types
export interface User {
  id: string;
  userId: string; // 7-digit unique ID
  email: string;
  password: string;
  fullName: string;
  phone: string;
  country: string;
  isActive: boolean;
  isAdmin: boolean;
  accountStatus?: 'active' | 'temp_blocked' | 'permanent_blocked';
  blockedAt?: string | null;
  blockedUntil?: string | null;
  blockedReason?: string | null;
  deactivationReason?: 'direct_referral_deadline' | null;
  reactivatedAt?: string | null;
  createdAt: string;
  activatedAt: string | null;
  gracePeriodEnd: string | null;
  sponsorId: string | null; // 7-digit sponsor ID
  parentId: string | null;
  position: 'left' | 'right' | null;
  level: number;
  directCount: number;
  totalEarnings: number;
  isCapped: boolean;
  capLevel: number;
  reEntryCount: number;
  cycleCount: number;
  // New fields for qualification
  requiredDirectForNextLevel: number;
  completedDirectForCurrentLevel: number;
  usdtAddress?: string;
  transactionPassword?: string; // Required for PIN transfers and sensitive operations
  emailVerified: boolean;
  // Offer achievements tracking
  achievements: UserAchievements;
  lastActions?: {
    email?: string;
    phone?: string;
    usdtAddress?: string;
    loginPassword?: string;
    transactionPassword?: string;
  };
}

// User Achievements for Tours
export interface UserAchievements {
  silverCoin?: boolean;
  silverCoinDate?: string;
  smartWatch?: boolean;
  smartWatchDate?: string;
  nationalTour?: boolean;
  nationalTourDate?: string;
  internationalTour?: boolean;
  internationalTourDate?: string;
  familyTour?: boolean;
  familyTourDate?: string;
  car?: boolean;
  carDate?: string;
  house?: boolean;
  houseDate?: string;
  [key: string]: any;
}

// PIN Types
export type PinStatus = 'unused' | 'used' | 'transferred' | 'suspended';

export interface Pin {
  id: string;
  pinCode: string; // 7-digit or alphanumeric PIN code
  amount: number;  // $11 default
  status: PinStatus;
  ownerId: string; // User who currently owns the PIN
  createdBy: string; // Admin who generated the PIN
  createdAt: string;
  usedAt?: string;
  usedById?: string; // User who used this PIN to register
  transferredFrom?: string; // Previous owner if transferred
  transferredAt?: string;
  registrationUserId?: string; // User ID created using this PIN
  suspendedAt?: string;
  suspendedBy?: string;
  suspensionReason?: string;
}

// PIN Wallet - Tracks user's PIN inventory
export interface PinWallet {
  userId: string;
  unusedPins: Pin[];      // Available PINs to use or transfer
  usedPins: Pin[];        // PINs that have been used for registration
  receivedPins: Pin[];    // PINs received from upline/downline
  transferredPins: Pin[]; // PINs transferred to others
}

// PIN Transfer Record
export interface PinTransfer {
  id: string;
  pinId: string;
  pinCode: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  transferredAt: string;
  notes?: string;
}

// Updated Wallet Types - Three wallet system
export interface Wallet {
  userId: string;
  // Three main wallets
  depositWallet: number;    // For deposits and withdrawals
  pinWallet: number;        // Tracks current unused PIN count
  incomeWallet: number;     // For earnings and income
  matrixWallet: number;     // Matrix-earned balance used for matrix give-help
  lockedIncomeWallet: number; // Unqualified level income locked until direct-referral requirement is met
  giveHelpLocked: number;
  totalReceived: number;
  totalGiven: number;
  // System fee tracking
  pendingSystemFee: number;         // Outstanding unpaid system fee (0 or 1)
  lastSystemFeeDate: string | null; // ISO date of last successfully collected fee
  // Reward points (marketplace)
  rewardPoints: number;
  totalRewardPointsEarned: number;
  totalRewardPointsRedeemed: number;
}

// Transaction Types - Updated
export type TransactionType =
  | 'activation'
  | 'income_transfer'
  | 'direct_income'
  | 'level_income'
  | 'give_help'
  | 'receive_help'
  | 'p2p_transfer'
  | 'withdrawal'
  | 'reentry'
  | 'safety_pool'
  | 'deposit'
  | 'pin_purchase'
  | 'pin_transfer'
  | 'pin_used'
  | 'admin_credit'
  | 'admin_debit'
  | 'system_fee';

export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  fromUserId?: string;
  toUserId?: string;
  level?: number;
  status: TransactionStatus;
  description: string;
  createdAt: string;
  completedAt?: string;
  // PIN related
  pinCode?: string;
  pinId?: string;
  // Security
  requiresTransactionPassword?: boolean;
  otpVerified?: boolean;
}

// Matrix Types
export interface MatrixNode {
  userId: string; // 7-digit ID
  username: string; // Display name (fullName)
  level: number;
  position: number; // 0 = left, 1 = right
  leftChild?: string; // 7-digit ID
  rightChild?: string; // 7-digit ID
  parentId?: string; // 7-digit ID
  isActive: boolean;
}

export interface MatrixTree {
  rootId: string;
  levels: MatrixLevel[];
  totalNodes: number;
}

export interface MatrixLevel {
  level: number;
  users: MatrixNode[];
  maxUsers: number;
}

// Updated Help Distribution Table - New Logic
export interface HelpDistribution {
  level: number;
  users: number;
  perUserHelp: number;
  totalReceiveHelp: number;
  giveHelp: number;
  netBalance: number;
  directRequired: number;
  // New fields for qualification
  qualifiedReceiveHelp: number;    // Amount for qualified users
  unqualifiedCarryForward: number; // Amount carried forward for unqualified
}

// Safety Pool Types
export interface SafetyPool {
  totalAmount: number;
  transactions: SafetyPoolTransaction[];
}

export interface SafetyPoolTransaction {
  id: string;
  amount: number;
  fromUserId: string;
  reason: string;
  createdAt: string;
}

// Grace Period Types
export interface GracePeriod {
  userId: string;
  type: 'activation' | 'direct_sponsor';
  startTime: string;
  endTime: string;
  isCompleted: boolean;
  warningSent: boolean;
}

// Re-Entry Types
export interface ReEntry {
  id: string;
  userId: string;
  previousCycleId: string;
  newCycleId: string;
  reEntryDate: string;
  activationAmount: number;
  previousEarnings: number;
}

// Stats Types
export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalHelpDistributed: number;
  totalInSafetyPool: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalLockedIncome: number;
  totalPinsSold: number;
  totalPinSoldAmount: number;
  totalIncomeWalletBalance: number;
  totalFundWalletBalance: number;
  balanceAmountRemaining: number;
  averageEarnings: number;
  topEarners: TopEarner[];
}

export interface TopEarner {
  userId: string;
  username: string;
  fullName: string;
  totalEarnings: number;
  avatar?: string;
}

// Auth Types
export interface LoginCredentials {
  userId: string; // 7-digit ID
  password: string;
}

// Updated Register Data with PIN
export interface RegisterData {
  fullName: string;
  email: string;
  password: string;
  transactionPassword: string; // Required for sensitive operations
  phone: string;
  country: string;
  sponsorId?: string; // 7-digit sponsor ID
  pinCode: string; // PIN for activation (mandatory)
}

// OTP Types for Email Verification
export interface OtpRecord {
  id: string;
  userId: string;
  email: string;
  otp: string;
  purpose: 'registration' | 'transaction' | 'withdrawal' | 'profile_update';
  createdAt: string;
  expiresAt: string;
  isUsed: boolean;
}

export interface EmailLog {
  id: string;
  to: string;
  subject: string;
  body: string;
  purpose: 'otp' | 'welcome' | 'system';
  provider: 'api' | 'local';
  status: 'queued' | 'sent' | 'failed';
  error?: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

// Notification Types
export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  createdAt: string;
}

// Admin Types
export interface AdminSettings {
  activationAmount: number;
  pinAmount: number; // $11 default
  directIncomePercent: number;
  helpingAmountPercent: number;
  adminFeePercent: number;
  withdrawalFeePercent: number;
  gracePeriodHours: number;
  maxLevels: number;
  reEntryEnabled: boolean;
  safetyPoolEnabled: boolean;
  activationDeadlineDays: number;
  directReferralDeadlineDays: number;
  // Security settings
  requireOtpForTransactions: boolean;
  masterPassword: string; // For admin to login as any user
  matrixViewMaxLevels: number;
}

// Network Types
export interface NetworkNode {
  id: string;
  userId: string;
  fullName: string;
  isActive: boolean;
  level: number;
  children: NetworkNode[];
  leftCount: number;
  rightCount: number;
  leftActive: number;
  rightActive: number;
}

// P2P Transfer
export interface P2PTransfer {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  status: TransactionStatus;
  createdAt: string;
  completedAt?: string;
}

// Withdrawal Request
export interface WithdrawalRequest {
  id: string;
  userId: string;
  amount: number;
  fee: number;
  netAmount: number;
  walletAddress: string;
  status: TransactionStatus;
  createdAt: string;
  processedAt?: string;
  transactionPasswordVerified: boolean;
}

// Payment Method Types
export type PaymentMethodType = 'crypto' | 'bank_transfer' | 'upi' | 'paypal' | 'stripe';

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  icon: string;
  description: string;
  instructions: string;
  walletAddress?: string;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  upiId?: string;
  qrCode?: string;
  isActive: boolean;
  minAmount: number;
  maxAmount: number;
  processingFee: number;
  processingTime: string;
}

// Payment Types
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'under_review';

export interface Payment {
  id: string;
  userId: string;
  amount: number;
  method: PaymentMethodType;
  methodName: string;
  status: PaymentStatus;
  txHash?: string;
  screenshot?: string;
  notes?: string;
  adminNotes?: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

// User Level Progress
export interface UserLevelProgress {
  currentLevel: number;
  requiredDirect: number;
  completedDirect: number;
  remainingDirect: number;
  totalReceiveHelpAtLevel: number;
  giveHelpAtLevel: number;
  netBalanceAtLevel: number;
  isQualified: boolean;
}

// Daily/Report Stats
export interface DailyStats {
  date: string;
  newUsers: number;
  newActivations: number;
  totalDeposits: number;
  totalWithdrawals: number;
  helpDistributed: number;
}

// Level-wise Report
export interface LevelWiseReport {
  level: number;
  userId: string;
  fullName: string;
  receiveHelpAmount: number;
  giveHelpAmount: number;
  netAmount: number;
  directReferralIncome?: number;
  incomeWallet?: number;
  totalEarning?: number;
  lockedHelp?: number;
  qualifiedLevel?: number;
  isQualified: boolean;
  directCount: number;
  date: string;
}

// PIN Purchase Request
export interface PinPurchaseRequest {
  id: string;
  userId: string;
  quantity: number;
  amount: number; // quantity * $11
  status: PaymentStatus;
  purchaseType?: 'request' | 'direct';
  paymentMethod?: PaymentMethodType;
  paymentProof?: string;
  paymentTxHash?: string;
  paidFromWallet?: boolean;
  adminNotes?: string;
  createdAt: string;
  processedAt?: string;
  processedBy?: string;
  pinsGenerated?: string[]; // List of PIN codes generated
}

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_user_response'
  | 'resolved'
  | 'closed';

export type SupportTicketPriority = 'low' | 'medium' | 'high';

export type SupportTicketCategory =
  | 'profile_update'
  | 'deposit_withdrawal'
  | 'network_matrix'
  | 'activation_pin'
  | 'affiliate_shopping'
  | 'other'
  // Legacy categories (for existing tickets)
  | 'account_issues'
  | 'deposit_payment_issues'
  | 'withdrawal_issues'
  | 'referral_matrix_issues'
  | 'technical_issues';

export interface SupportTicketAttachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  data_url: string;
  uploaded_by: string;
  uploaded_at: string;
  message_id?: string;
}

export interface SupportTicketMessage {
  id: string;
  sender_type: 'user' | 'admin';
  sender_user_id: string;
  sender_name: string;
  message: string;
  attachments: SupportTicketAttachment[];
  created_at: string;
}

// Ticket schema uses snake_case keys so backend collections stay consistent.
export interface SupportTicket {
  ticket_id: string;
  user_id: string;
  category: SupportTicketCategory;
  subject: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  messages: SupportTicketMessage[];
  attachments: SupportTicketAttachment[];
  created_at: string;
  updated_at: string;
  admin_reply: string;
  name: string;
  email: string;
}

// ==================== MARKETPLACE TYPES ====================

export interface MarketplaceCategory {
  id: string;
  name: string;
  slug: string;
  icon: string; // Lucide icon name
  sortOrder: number;
  isActive: boolean;
}

export interface MarketplaceRetailer {
  id: string;
  name: string;
  logoUrl: string; // base64 data URL or external URL
  discountPercent: number;
  discountText: string; // e.g. "Up to 30% Cashback"
  websiteUrl: string;
  affiliateLink: string;
  categoryId: string;
  isTopRetailer: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface MarketplaceBanner {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string; // base64 data URL or gradient CSS
  linkUrl: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MarketplaceDeal {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  linkUrl: string;
  retailerId: string;
  badgeText: string; // e.g. "Hot Deal", "New"
  sortOrder: number;
  isActive: boolean;
  startDate: string;
  endDate: string;
}

export type MarketplaceInvoiceStatus = 'pending' | 'approved' | 'rejected';

export interface MarketplaceInvoice {
  id: string;
  userId: string;
  retailerId: string;
  retailerName: string;
  amount: number;
  invoiceImage: string; // base64 data URL
  status: MarketplaceInvoiceStatus;
  rewardPoints: number; // points awarded on approval
  adminNotes: string;
  createdAt: string;
  processedAt: string | null;
  processedBy: string | null;
}

export type RedemptionStatus = 'pending' | 'approved' | 'rejected';

export interface RewardRedemption {
  id: string;
  userId: string;
  rewardPoints: number;
  usdtAmount: number; // rewardPoints * 0.01
  status: RedemptionStatus;
  adminNotes: string;
  createdAt: string;
  processedAt: string | null;
  processedBy: string | null;
}

// Admin Impersonation Session
export interface ImpersonationSession {
  adminId: string;
  adminUserId: string;
  targetUserId: string;
  targetUserName: string;
  startedAt: string;
  isActive: boolean;
}


