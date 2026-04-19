/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useOtpStore, usePinStore, useSyncRefreshKey } from '@/store';
import Database from '@/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import MobileBottomNav from '@/components/MobileBottomNav';
import { ArrowLeft, CheckCircle, Loader2, UserPlus, Eye, EyeOff } from 'lucide-react';
import {
  getDialCodeForCountry,
  getPasswordRequirementsText,
  getTransactionPasswordRequirementsText,
  isStrongPassword,
  isValidPhoneNumberForCountry,
  isValidTransactionPassword,
  normalizePhoneNumber
} from '@/utils/helpers';
import { useOtpResend } from '@/hooks/use-otp-resend';

export default function CreateId() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, register } = useAuthStore();
  const { sendOtp, verifyOtp } = useOtpStore();
  const { unusedPins, loadPins } = usePinStore();
  const displayUser = impersonatedUser || user;
  const syncKey = useSyncRefreshKey();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    country: '',
    sponsorId: '',
    pinCode: '',
    password: '',
    confirmPassword: '',
    transactionPassword: '',
    confirmTransactionPassword: '',
    agreeTerms: false
  });
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showConfirmLoginPassword, setShowConfirmLoginPassword] = useState(false);
  const [showTxPassword, setShowTxPassword] = useState(false);
  const [showConfirmTxPassword, setShowConfirmTxPassword] = useState(false);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorStatusMessage, setSponsorStatusMessage] = useState('');
  const [isSponsorEditing, setIsSponsorEditing] = useState(false);
  const [error, setError] = useState('');
  const [successUserId, setSuccessUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isPinChecking, setIsPinChecking] = useState(false);
  const otpResend = useOtpResend(30);
  const pinRefreshInFlight = useRef<Promise<void> | null>(null);
  const lastPinRefresh = useRef<number>(0);
  const selectedPinRef = useRef('');
  const displayUserIdRef = useRef<string | null>(null);
  const successBannerRef = useRef<HTMLDivElement | null>(null);
  const submitInFlightRef = useRef(false);

  const isEmailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const countries = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
    'France', 'India', 'Pakistan', 'Nigeria', 'South Africa', 'Brazil',
    'Mexico', 'China', 'Japan', 'South Korea', 'Singapore', 'Malaysia',
    'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'UAE', 'Saudi Arabia',
    'Other'
  ];

  const resolveDisplayUserOwnerId = (): string | null => {
    if (!displayUser) return null;
    const byUserCode = displayUser.userId ? Database.getUserByUserId(displayUser.userId) : null;
    return byUserCode?.id || displayUser.id || null;
  };

  const isPinCurrentlyUnused = (pinCode: string): boolean => {
    const normalizedPinCode = String(pinCode || '').trim().toUpperCase();
    if (!normalizedPinCode) return false;

    const currentUserId = displayUserIdRef.current || resolveDisplayUserOwnerId();
    if (currentUserId) {
      const matchesLocal = Database.getUnusedPins(currentUserId)
        .some((pin) => String(pin.pinCode || '').trim().toUpperCase() === normalizedPinCode);
      if (matchesLocal) return true;
    }

    return unusedPins
      .some((pin) => String(pin.pinCode || '').trim().toUpperCase() === normalizedPinCode);
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;
    loadPins(displayUser.id);
  }, [displayUser, isAuthenticated, loadPins, navigate, syncKey]);

  useEffect(() => {
    if (!displayUser) return;
    setFormData(prev => ({ ...prev, sponsorId: displayUser.userId }));
    setSponsorName(displayUser.fullName);
    setSponsorStatusMessage('');
    setIsSponsorEditing(false);
  }, [displayUser?.id, displayUser?.userId, displayUser?.fullName]);

  useEffect(() => {
    displayUserIdRef.current = resolveDisplayUserOwnerId();
  }, [displayUser?.id, displayUser?.userId]);

  useEffect(() => {
    selectedPinRef.current = formData.pinCode;
  }, [formData.pinCode]);

  useEffect(() => {
    if (!successUserId) return;
    const scrollTask = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      successBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(scrollTask);
  }, [successUserId]);

  const refreshPins = async () => {
    const now = Date.now();
    if (now - lastPinRefresh.current < 4000) return;
    if (pinRefreshInFlight.current) {
      await pinRefreshInFlight.current;
      return;
    }
    const task = Database.hydrateFromServer({
      strict: true,
      maxAttempts: 2,
      timeoutMs: 8000,
      retryDelayMs: 600,
      keys: Database.getPinFreshDataKeys()
    })
      .then(() => {
        const currentUserId = displayUserIdRef.current;
        if (currentUserId) {
          loadPins(currentUserId);
        }
      })
      .catch(() => {});
    pinRefreshInFlight.current = task;
    lastPinRefresh.current = now;
    await task;
    pinRefreshInFlight.current = null;
  };

  const handlePinChange = async (value: string) => {
    setFormData(prev => ({ ...prev, pinCode: value }));
    if (!value) {
      setIsPinChecking(false);
      return;
    }
    setIsPinChecking(true);
    await refreshPins();
    if (selectedPinRef.current !== value) {
      setIsPinChecking(false);
      return;
    }
    const stillUnused = isPinCurrentlyUnused(value);
    if (!stillUnused) {
      setError('Selected PIN is no longer available');
      setFormData(prev => ({ ...prev, pinCode: '' }));
    }
    setIsPinChecking(false);
  };

  const handleSponsorIdChange = (value: string) => {
    const cleanValue = value.replace(/\D/g, '').slice(0, 7);
    setFormData(prev => ({ ...prev, sponsorId: cleanValue }));
    if (cleanValue.length === 7) {
      const sponsor = Database.getUserByUserId(cleanValue);
      setSponsorName(sponsor?.fullName || '');
      setSponsorStatusMessage(sponsor ? '' : 'User does not exist with this Sponsor ID');
    } else {
      setSponsorName('');
      setSponsorStatusMessage(cleanValue ? 'Enter a valid 7-digit Sponsor ID' : '');
    }
  };

  const handleSponsorEditToggle = () => {
    setError('');
    setSponsorStatusMessage('');
    setIsSponsorEditing(true);
  };

  const handleSponsorSave = () => {
    const cleanSponsorId = formData.sponsorId.replace(/\D/g, '').slice(0, 7);
    if (cleanSponsorId.length !== 7) {
      setSponsorStatusMessage('Enter a valid 7-digit Sponsor ID');
      setError('Enter a valid 7-digit Sponsor ID');
      return;
    }

    const sponsor = Database.getUserByUserId(cleanSponsorId);
    if (!sponsor) {
      setSponsorStatusMessage('User does not exist with this Sponsor ID');
      setError('Sponsor ID not found');
      setSponsorName('');
      return;
    }

    setFormData(prev => ({ ...prev, sponsorId: cleanSponsorId }));
    setSponsorName(sponsor.fullName || '');
    setSponsorStatusMessage('');
    setIsSponsorEditing(false);
  };

  const resetOtpFlow = () => {
    setOtpCode('');
    setOtpSent(false);
    setOtpVerified(false);
    setIsSendingOtp(false);
    setIsVerifyingOtp(false);
    otpResend.resetCooldown();
  };

  const handleEmailChange = (value: string) => {
    setFormData((prev) => ({ ...prev, email: value }));
    resetOtpFlow();
  };

  const applyDialCode = (value: string, countryName: string) => {
    const dial = getDialCodeForCountry(countryName);
    if (!dial) return value;
    const dialDigits = dial.replace(/\D/g, '');
    const digits = value.replace(/\D/g, '');
    let localDigits = digits;
    if (digits.startsWith(dialDigits)) {
      localDigits = digits.slice(dialDigits.length);
    }
    return dial + (localDigits ? ` ${localDigits}` : '');
  };

  const handlePhoneChange = (value: string) => {
    setFormData((prev) => ({ ...prev, phone: applyDialCode(value, prev.country) }));
    resetOtpFlow();
  };

  const handleCountryChange = (value: string) => {
    setFormData((prev) => ({ ...prev, country: value, phone: applyDialCode(prev.phone, value) }));
    resetOtpFlow();
  };

  const getCreateIdOtpKey = () => `createid_${formData.email.trim().toLowerCase()}`;

  const handleSendOtp = async () => {
    setError('');
    if (!isEmailValid(formData.email)) {
      setError('Enter a valid email before sending OTP');
      return;
    }
    if (!isValidPhoneNumberForCountry(formData.phone, formData.country)) {
      setError('Enter a valid mobile number before sending OTP');
      return;
    }

    setIsSendingOtp(true);
    const result = await sendOtp(getCreateIdOtpKey(), formData.email.trim(), 'registration', {
      userName: formData.fullName.trim()
    });
    setIsSendingOtp(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setOtpSent(true);
    setOtpVerified(false);
    otpResend.startCooldown();
  };

  const handleVerifyOtpCode = async () => {
    setError('');
    if (otpCode.trim().length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    setIsVerifyingOtp(true);
    const valid = await verifyOtp(getCreateIdOtpKey(), otpCode.trim(), 'registration');
    setIsVerifyingOtp(false);

    if (!valid) {
      setError('Invalid or expired OTP');
      return;
    }

    setOtpVerified(true);
  };

  const validate = () => {
    if (!formData.fullName.trim()) return 'Name is required';
    if (!formData.email.trim()) return 'Email is required';
    if (!formData.phone.trim()) return 'Mobile number is required';
    if (!isValidPhoneNumberForCountry(formData.phone, formData.country)) return 'Enter a valid mobile number for the selected country';
    if (!formData.country.trim()) return 'Country is required';
    if (isSponsorEditing) return 'Save Sponsor ID before creating ID';
    if (!formData.sponsorId || formData.sponsorId.length !== 7) return 'Valid sponsor ID is required';
    if (!sponsorName) return 'Sponsor ID not found';
    if (!formData.pinCode) return 'Please select a PIN';
    if (!isPinCurrentlyUnused(formData.pinCode)) return 'Selected PIN is not available';
    if (!isStrongPassword(formData.password)) return getPasswordRequirementsText();
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match';
    if (!isValidTransactionPassword(formData.transactionPassword)) return getTransactionPasswordRequirementsText();
    if (formData.transactionPassword !== formData.confirmTransactionPassword) return 'Transaction passwords do not match';
    if (!otpVerified) return 'Verify OTP sent to email before creating ID';
    if (!formData.agreeTerms) return 'Please accept terms and conditions';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitInFlightRef.current || isLoading) {
      return;
    }
    setError('');
    setSuccessUserId('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (formData.pinCode) {
      setIsPinChecking(true);
      await refreshPins();
      const stillUnused = isPinCurrentlyUnused(formData.pinCode);
      setIsPinChecking(false);
      if (!stillUnused) {
        setError('Selected PIN is no longer available');
        return;
      }
    }

    if (submitInFlightRef.current || isLoading) {
      return;
    }
    submitInFlightRef.current = true;
    setIsLoading(true);

    try {
      const result = await register({
        fullName: formData.fullName,
        email: formData.email,
        password: formData.password,
        transactionPassword: formData.transactionPassword,
        phone: normalizePhoneNumber(formData.phone),
        country: formData.country,
        sponsorId: formData.sponsorId,
        pinCode: formData.pinCode
      });

      if (!result.success) {
        setError(result.message);
        return;
      }

      setSuccessUserId(result.userId || '');
      if (displayUser) {
        loadPins(displayUser.id);
      }

      setFormData({
        fullName: '',
        email: '',
        phone: '',
        country: '',
        sponsorId: displayUser?.userId || '',
        pinCode: '',
        password: '',
        confirmPassword: '',
        transactionPassword: '',
        confirmTransactionPassword: '',
        agreeTerms: false
      });
      setSponsorName(displayUser?.fullName || '');
      setIsSponsorEditing(false);
      resetOtpFlow();
    } finally {
      setIsLoading(false);
      submitInFlightRef.current = false;
    }
  };

  if (!displayUser) return null;

  return (
    <div className="createid-page min-h-screen bg-[#0a0e17] p-3 pb-24 sm:p-4 md:pb-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
            className="text-white/60 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#004e9a] flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white">Create New ID</h1>
            <p className="text-xs text-white/50">Use your PIN wallet to activate a new account</p>
          </div>
        </div>

        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Signup from User Panel</CardTitle>
            <CardDescription className="text-white/60">
              PIN will be used immediately and new ID will be activated automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4 bg-red-500/10 border-red-500/30">
                <AlertDescription className="text-red-400">{error}</AlertDescription>
              </Alert>
            )}

            {successUserId && (
              <div
                ref={successBannerRef}
                className="mb-5 overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/18 via-emerald-500/8 to-[#0f172a] shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
              >
                <div className="p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                      <CheckCircle className="h-7 w-7" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300/80">Create ID Success</p>
                      <h2 className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">ID created successfully</h2>
                      <p className="mt-2 text-sm text-emerald-100/80">The new account has been created and activated.</p>
                      <div className="mt-4 inline-flex items-center rounded-xl border border-emerald-400/25 bg-black/20 px-4 py-3">
                        <span className="text-xs uppercase tracking-[0.2em] text-emerald-200/70">New ID</span>
                        <span className="ml-3 text-2xl font-black tracking-[0.18em] text-emerald-300">{successUserId}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Name</Label>
                  <Input
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Country</Label>
                  <select
                    value={formData.country}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    className="w-full rounded-md bg-[#1f2937] border border-white/10 px-3 py-2.5 text-white"
                  >
                    <option value="" className="bg-[#1f2937]">Select your country</option>
                    {countries.map((country) => (
                      <option key={country} value={country} className="bg-[#1f2937]">
                        {country}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Mobile Number</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Sponsor ID</Label>
                  <div className="flex gap-2">
                    <Input
                      value={formData.sponsorId}
                      onChange={(e) => handleSponsorIdChange(e.target.value)}
                      maxLength={7}
                      disabled={!isSponsorEditing}
                      className="bg-[#1f2937] border-white/10 text-white disabled:opacity-100 disabled:cursor-default"
                    />
                    <Button
                      type="button"
                      variant={isSponsorEditing ? 'default' : 'outline'}
                      onClick={isSponsorEditing ? handleSponsorSave : handleSponsorEditToggle}
                      className={isSponsorEditing
                        ? 'btn-primary whitespace-nowrap'
                        : 'whitespace-nowrap border-white/20 text-white hover:bg-white/10'}
                    >
                      {isSponsorEditing ? 'Save Sponsor' : 'Change Sponsor'}
                    </Button>
                  </div>
                  {sponsorName && (
                    <p className="text-xs text-emerald-400">Sponsor: {sponsorName}</p>
                  )}
                  {!sponsorName && sponsorStatusMessage && (
                    <p className="text-xs text-amber-400">{sponsorStatusMessage}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">PIN Dropdown</Label>
                  <select
                    value={formData.pinCode}
                    onChange={(e) => void handlePinChange(e.target.value)}
                    className="w-full h-10 px-3 rounded-md bg-[#1f2937] border border-white/10 text-white"
                  >
                    <option value="">Select unused PIN</option>
                    {unusedPins.map(pin => (
                      <option key={pin.id} value={pin.pinCode}>
                        {pin.pinCode}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-white/50">Unused PINs available: {unusedPins.length}</p>
                  {isPinChecking && (
                    <p className="text-xs text-white/60 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Checking PIN availability...
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Password</Label>
                  <div className="relative">
                    <Input
                      type={showLoginPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="bg-[#1f2937] border-white/10 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-white/40">{getPasswordRequirementsText()}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmLoginPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className="bg-[#1f2937] border-white/10 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmLoginPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showConfirmLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Transaction Password</Label>
                  <div className="relative">
                    <Input
                      type={showTxPassword ? 'text' : 'password'}
                      value={formData.transactionPassword}
                      onChange={(e) => setFormData({ ...formData, transactionPassword: e.target.value })}
                      className="bg-[#1f2937] border-white/10 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTxPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showTxPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-white/40">{getTransactionPasswordRequirementsText()}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Confirm Transaction Password</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmTxPassword ? 'text' : 'password'}
                      value={formData.confirmTransactionPassword}
                      onChange={(e) => setFormData({ ...formData, confirmTransactionPassword: e.target.value })}
                      className="bg-[#1f2937] border-white/10 text-white pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmTxPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showConfirmTxPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-white/10 bg-[#1f2937]/50 p-3">
                <Label className="text-white/80">Email OTP Verification</Label>
                <p className="text-xs text-white/50">
                  Verify using OTP sent to <span className="text-white/70">{formData.email || 'new user email'}</span>
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={isSendingOtp || otpResend.isCoolingDown}
                    className="w-full sm:w-auto btn-primary"
                  >
                    {isSendingOtp ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : otpSent
                      ? (otpResend.isCoolingDown ? `Resend in ${otpResend.remainingSeconds}s` : 'Resend OTP')
                      : 'Send OTP'}
                  </Button>
                  {otpVerified && (
                    <span className="inline-flex items-center text-emerald-400 text-sm">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      OTP Verified
                    </span>
                  )}
                </div>
                {otpSent && !otpVerified && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter 6-digit OTP"
                      className="bg-[#1f2937] border-white/10 text-white"
                    />
                    <Button
                      type="button"
                      onClick={handleVerifyOtpCode}
                      disabled={isVerifyingOtp}
                      variant="outline"
                      className="border-white/20 text-white hover:bg-white/10"
                    >
                      {isVerifyingOtp ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Verifying...
                        </>
                      ) : 'Verify OTP'}
                    </Button>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={formData.agreeTerms}
                  onChange={(e) => setFormData({ ...formData, agreeTerms: e.target.checked })}
                  className="rounded border-white/20 bg-[#1f2937]"
                />
                I agree to terms and conditions
              </label>

              <Button type="submit" disabled={isLoading || !otpVerified} className="w-full btn-primary">
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating ID...
                  </>
                ) : (
                  'Create and Activate ID'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <MobileBottomNav />
    </div>
  );
}
