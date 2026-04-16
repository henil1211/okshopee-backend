import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuthStore, useOtpStore, useSyncRefreshKey } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Eye, EyeOff, Loader2, User, Lock, Mail, Phone, Globe, 
  ArrowRight, CheckCircle, UserPlus, IdCard, ArrowLeft,
  Key, Copy, Check, Ticket
} from 'lucide-react';
import Database from '@/db';
import PublicFooter from '@/components/PublicFooter';
import {
  getDialCodeForCountry,
  getPasswordRequirementsText,
  getTransactionPasswordRequirementsText,
  isStrongPassword,
  isValidPhoneNumberForCountry,
  isValidTransactionPassword,
  normalizePhoneNumber
} from '@/utils/helpers';
import { AUTH_MAINTENANCE_ENABLED, AUTH_MAINTENANCE_MESSAGE } from '@/lib/maintenance';

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sponsorParam = searchParams.get('sponsor');
  const syncKey = useSyncRefreshKey();
  
  const { register } = useAuthStore();
  const { sendOtp, verifyOtp } = useOtpStore();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    transactionPassword: '',
    confirmTransactionPassword: '',
    phone: '',
    country: '',
    sponsorId: sponsorParam || '',
    pinCode: ''
  });
  const [sponsorName, setSponsorName] = useState('');
  const [pinValid, setPinValid] = useState(false);
  const [pinOwner, setPinOwner] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showTransactionPassword, setShowTransactionPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [registeredUserId, setRegisteredUserId] = useState('');
  const [registeredPassword, setRegisteredPassword] = useState('');
  const [registeredTransactionPassword, setRegisteredTransactionPassword] = useState('');
  const [step, setStep] = useState(1);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isPinChecking, setIsPinChecking] = useState(false);
  const successBannerRef = useRef<HTMLDivElement | null>(null);
  const pinCodeRef = useRef('');
  const pinRefreshInFlight = useRef<Promise<void> | null>(null);
  const lastPinRefresh = useRef<{ code: string; at: number } | null>(null);
  const submitInFlightRef = useRef(false);

  const isEmailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  // Validate sponsor when prefilled or changed
  useEffect(() => {
    const cleanValue = (formData.sponsorId || '').trim();
    if (cleanValue.length === 7) {
      const sponsor = Database.getUserByUserId(cleanValue);
      setSponsorName(sponsor ? sponsor.fullName : '');
    } else {
      setSponsorName('');
    }
  }, [formData.sponsorId, syncKey]);

  useEffect(() => {
    pinCodeRef.current = formData.pinCode;
  }, [formData.pinCode]);

  useEffect(() => {
    if (!success) return;
    const scrollTask = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      successBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(scrollTask);
  }, [success]);

  // Check sponsor ID when entered
  const handleSponsorIdChange = (value: string) => {
    const cleanValue = value.replace(/\D/g, '').slice(0, 7);
    setFormData({ ...formData, sponsorId: cleanValue });
    
    if (cleanValue.length === 7) {
      const sponsor = Database.getUserByUserId(cleanValue);
      if (sponsor) {
        setSponsorName(sponsor.fullName);
      } else {
        setSponsorName('');
      }
    } else {
      setSponsorName('');
    }
  };

  const refreshPinsForCode = async (code: string) => {
    const now = Date.now();
    const last = lastPinRefresh.current;
    if (last && last.code === code && now - last.at < 4000) {
      return;
    }
    if (pinRefreshInFlight.current) {
      await pinRefreshInFlight.current;
      return;
    }
    const refresh = Database.hydrateFromServer({ strict: true, maxAttempts: 2, timeoutMs: 12000, retryDelayMs: 800 })
      .then(() => {})
      .catch(() => {});
    pinRefreshInFlight.current = refresh;
    lastPinRefresh.current = { code, at: now };
    await refresh;
    pinRefreshInFlight.current = null;
  };

  // Check PIN when entered
  const handlePinChange = async (value: string) => {
    const cleanValue = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
    setFormData({ ...formData, pinCode: cleanValue });
    
    if (cleanValue.length === 7) {
      const applyPinStatus = (pin: ReturnType<typeof Database.getPinByCode>) => {
        if (pin && pin.status === 'unused') {
          setPinValid(true);
          const owner = Database.getUserById(pin.ownerId);
          setPinOwner(owner?.fullName || 'System');
          return true;
        }
        setPinValid(false);
        setPinOwner('');
        return false;
      };

      setIsPinChecking(true);
      applyPinStatus(Database.getPinByCode(cleanValue));
      await refreshPinsForCode(cleanValue);
      if (pinCodeRef.current !== cleanValue) {
        setIsPinChecking(false);
        return;
      }
      applyPinStatus(Database.getPinByCode(cleanValue));
      setIsPinChecking(false);
    } else {
      setPinValid(false);
      setPinOwner('');
      setIsPinChecking(false);
    }
  };

  const resetOtpFlow = () => {
    setOtpCode('');
    setOtpSent(false);
    setOtpVerified(false);
    setIsSendingOtp(false);
    setIsVerifyingOtp(false);
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
    setFormData((prev) => ({
      ...prev,
      phone: applyDialCode(value, prev.country)
    }));
    resetOtpFlow();
  };

  const handleCountryChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      country: value,
      phone: applyDialCode(prev.phone, value)
    }));
    resetOtpFlow();
  };

  const getRegistrationOtpKey = () => `register_${formData.email.trim().toLowerCase()}`;

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
    const result = await sendOtp(getRegistrationOtpKey(), formData.email.trim(), 'registration', {
      userName: formData.fullName.trim()
    });
    setIsSendingOtp(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setOtpSent(true);
    setOtpVerified(false);
  };

  const handleVerifyOtpCode = async () => {
    setError('');
    if (otpCode.trim().length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    setIsVerifyingOtp(true);
    const valid = await verifyOtp(getRegistrationOtpKey(), otpCode.trim(), 'registration');
    setIsVerifyingOtp(false);

    if (!valid) {
      setError('Invalid or expired OTP');
      return;
    }

    setOtpVerified(true);
  };

  const validateStep1 = () => {
    if (!formData.fullName.trim()) return 'Full name is required';
    if (!formData.email.trim()) return 'Email is required';
    if (!isEmailValid(formData.email)) return 'Invalid email format';
    if (!formData.sponsorId?.trim()) return 'Sponsor ID is required';
    if (formData.sponsorId.length !== 7) return 'Sponsor ID must be 7 digits';
    const sponsor = Database.getUserByUserId(formData.sponsorId);
    if (!sponsor) return 'Invalid Sponsor ID';
    return '';
  };

  const validateStep2 = () => {
    if (!formData.pinCode) return 'PIN code is required for registration';
    if (formData.pinCode.length !== 7) return 'PIN must be 7 characters';
    const pin = Database.getPinByCode(formData.pinCode);
    if (!pin) return 'Invalid PIN code';
    if (pin.status === 'suspended') return 'PIN is suspended by admin';
    if (pin.status !== 'unused') return 'PIN has already been used';
    return '';
  };

  const validateStep3 = () => {
    if (!formData.password) return 'Password is required';
    if (!isStrongPassword(formData.password)) return getPasswordRequirementsText();
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match';
    if (!formData.transactionPassword) return 'Transaction password is required';
    if (!isValidTransactionPassword(formData.transactionPassword)) return getTransactionPasswordRequirementsText();
    if (formData.transactionPassword !== formData.confirmTransactionPassword) return 'Transaction passwords do not match';
    if (formData.transactionPassword === formData.password) return 'Transaction password should be different from login password';
    if (!formData.phone?.trim()) return 'Phone number is required';
    if (!isValidPhoneNumberForCountry(formData.phone, formData.country)) return 'Enter a valid mobile number for the selected country';
    if (!formData.country?.trim()) return 'Country is required';
    if (!otpVerified) return 'Verify OTP sent to your email before creating account';
    return '';
  };

  const handleNext = () => {
    let error = '';
    if (step === 1) {
      error = validateStep1();
    } else if (step === 2) {
      error = validateStep2();
    }
    
    if (error) {
      setError(error);
      return;
    }
    setError('');
    setStep(step + 1);
  };

  const handleBack = () => {
    setError('');
    setStep(step - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitInFlightRef.current || isLoading) {
      return;
    }
    setError('');

    const validationError = validateStep3();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (formData.pinCode.length === 7) {
      setIsPinChecking(true);
      await refreshPinsForCode(formData.pinCode);
      const latestPin = Database.getPinByCode(formData.pinCode);
      setIsPinChecking(false);
      if (!latestPin || latestPin.status !== 'unused') {
        setError('Invalid or already used PIN');
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
        sponsorId: formData.sponsorId || undefined,
        pinCode: formData.pinCode
      });

      if (result.success) {
        setSuccess(result.message);
        setRegisteredUserId(result.userId || '');
        setRegisteredPassword(formData.password);
        setRegisteredTransactionPassword(formData.transactionPassword);
      } else {
        setError(result.message);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
      submitInFlightRef.current = false;
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const countries = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
    'France', 'India', 'Pakistan', 'Nigeria', 'South Africa', 'Brazil',
    'Mexico', 'China', 'Japan', 'South Korea', 'Singapore', 'Malaysia',
    'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'UAE', 'Saudi Arabia',
    'Other'
  ];

  if (AUTH_MAINTENANCE_ENABLED) {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4 network-bg">
          <Card className="glass border-white/10 max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-white text-center">Registration Unavailable</CardTitle>
              <CardDescription className="text-center text-white/70">{AUTH_MAINTENANCE_MESSAGE}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/login')} className="w-full btn-primary">
                Back to Login
              </Button>
            </CardContent>
          </Card>
        </div>
        <PublicFooter />
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4 network-bg">
          <Card className="glass border-white/10 max-w-md w-full">
            <CardContent ref={successBannerRef} className="p-8">
              <div className="text-center mb-6">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-10 h-10 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Registration Successful!</h2>
                <p className="text-white/60">Your account has been created and activated.</p>
              </div>
              
              <div className="space-y-4 mb-6">
                <div className="p-4 rounded-lg bg-[#1f2937] border border-emerald-500/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-white/50">Your User ID</p>
                    <button 
                      onClick={() => copyToClipboard(registeredUserId, 'userid')}
                      className="text-[#118bdd] hover:text-[#38bdf5] transition-colors"
                    >
                      {copiedField === 'userid' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-2xl font-bold text-[#118bdd] tracking-wider">{registeredUserId}</p>
                </div>

                <div className="p-4 rounded-lg bg-[#1f2937]">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-white/50">Login Password</p>
                    <button 
                      onClick={() => copyToClipboard(registeredPassword, 'password')}
                      className="text-[#118bdd] hover:text-[#38bdf5] transition-colors"
                    >
                      {copiedField === 'password' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-lg font-mono text-white">{registeredPassword}</p>
                </div>

                <div className="p-4 rounded-lg bg-[#1f2937] border border-amber-500/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-amber-400">Transaction Password</p>
                    <button 
                      onClick={() => copyToClipboard(registeredTransactionPassword, 'transpassword')}
                      className="text-[#118bdd] hover:text-[#38bdf5] transition-colors"
                    >
                      {copiedField === 'transpassword' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-lg font-mono text-white">{registeredTransactionPassword}</p>
                  <p className="text-xs text-amber-400/70 mt-1">Required for withdrawals and PIN transfers</p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-6">
                <p className="text-sm text-amber-400 text-center">
                  <strong>Important:</strong> Please save these credentials. They will not be shown again.
                </p>
              </div>

              <div className="space-y-3">
                <Button 
                  onClick={() => navigate('/login')}
                  className="w-full btn-primary"
                >
                  Go to Login
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => {
                    setSuccess('');
                    setFormData({
                      fullName: '',
                      email: '',
                      password: '',
                      confirmPassword: '',
                      transactionPassword: '',
                      confirmTransactionPassword: '',
                      phone: '',
                      country: '',
                      sponsorId: '',
                      pinCode: ''
                    });
                    resetOtpFlow();
                    setStep(1);
                  }}
                  className="w-full border-white/20 text-white hover:bg-white/10"
                >
                  Register Another Account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <PublicFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4 network-bg">
        <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#004e9a] flex items-center justify-center">
            <UserPlus className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">Create Account</span>
        </div>

        <Card className="glass border-white/10">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step >= 1 ? 'bg-[#118bdd] text-white' : 'bg-[#1f2937] text-white/40'
              }`}>
                1
              </div>
              <div className={`w-8 h-0.5 ${step >= 2 ? 'bg-[#118bdd]' : 'bg-[#1f2937]'}`} />
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step >= 2 ? 'bg-[#118bdd] text-white' : 'bg-[#1f2937] text-white/40'
              }`}>
                2
              </div>
              <div className={`w-8 h-0.5 ${step >= 3 ? 'bg-[#118bdd]' : 'bg-[#1f2937]'}`} />
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step >= 3 ? 'bg-[#118bdd] text-white' : 'bg-[#1f2937] text-white/40'
              }`}>
                3
              </div>
            </div>
            <CardTitle className="text-xl font-bold text-white text-center">
              {step === 1 ? 'Personal Information' : step === 2 ? 'PIN Activation' : 'Security Setup'}
            </CardTitle>
            <CardDescription className="text-center text-white/60">
              {step === 1 ? 'Enter your basic details' : step === 2 ? 'Enter your activation PIN' : 'Set up your passwords'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4 bg-red-500/10 border-red-500/30">
                <AlertDescription className="text-red-400">{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {step === 1 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-white/80">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="fullName"
                        type="text"
                        placeholder="John Doe"
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        className="pl-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white/80">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="john@example.com"
                        value={formData.email}
                        onChange={(e) => handleEmailChange(e.target.value)}
                        className="pl-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sponsorId" className="text-white/80">
                      Sponsor ID <span className="text-red-400 text-xs">(Required)</span>
                    </Label>
                    <div className="relative">
                      <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="sponsorId"
                        type="text"
                        maxLength={7}
                        placeholder="Enter 7-digit sponsor ID"
                        value={formData.sponsorId}
                        onChange={(e) => handleSponsorIdChange(e.target.value)}
                        className="pl-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                    </div>
                    {sponsorName && (
                      <p className="text-sm text-emerald-400 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Sponsor: {sponsorName}
                      </p>
                    )}
                    {formData.sponsorId.length === 7 && !sponsorName && (
                      <p className="text-sm text-red-400">Invalid Sponsor ID</p>
                    )}
                  </div>

                  <Button
                    type="button"
                    onClick={handleNext}
                    className="w-full btn-primary h-11"
                  >
                    Next Step
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="p-4 rounded-lg bg-[#1f2937] border border-[#118bdd]/30 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Ticket className="w-5 h-5 text-[#118bdd]" />
                      <span className="text-white font-medium">PIN Activation Required</span>
                    </div>
                    <p className="text-sm text-white/60">
                      You need a valid PIN to register. Each PIN costs $11 and activates your account immediately.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pinCode" className="text-white/80">
                      PIN Code <span className="text-red-400">*</span>
                    </Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="pinCode"
                        type="text"
                        maxLength={7}
                        placeholder="Enter 7-character PIN code"
                        value={formData.pinCode}
                        onChange={(e) => handlePinChange(e.target.value)}
                        className={`pl-10 bg-[#1f2937] border text-white placeholder:text-white/40 focus:ring-[#118bdd]/20 uppercase ${
                          pinValid 
                            ? 'border-emerald-500 focus:border-emerald-500' 
                            : formData.pinCode.length === 7 
                              ? 'border-red-500 focus:border-red-500'
                              : 'border-white/10 focus:border-[#118bdd]'
                        }`}
                      />
                    </div>
                    {pinValid && (
                      <p className="text-sm text-emerald-400 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Valid PIN from {pinOwner}
                      </p>
                    )}
                    {isPinChecking && formData.pinCode.length === 7 && (
                      <p className="text-sm text-white/60 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Checking PIN...
                      </p>
                    )}
                    {formData.pinCode.length === 7 && !pinValid && !isPinChecking && (
                      <p className="text-sm text-red-400">Invalid or already used PIN</p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBack}
                      className="flex-1 h-11 border-white/20 text-white hover:bg-white/10"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={handleNext}
                      disabled={!pinValid}
                      className="flex-1 btn-primary h-11"
                    >
                      Next Step
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-white/80">Login Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Create a strong password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="pl-10 pr-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-white/40">{getPasswordRequirementsText()}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-white/80">Confirm Login Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Confirm your password"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        className="pl-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="transactionPassword" className="text-white/80">
                      Transaction Password <span className="text-amber-400 text-xs">(For withdrawals & PIN transfers)</span>
                    </Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="transactionPassword"
                        type={showTransactionPassword ? 'text' : 'password'}
                        placeholder="Create transaction password"
                        value={formData.transactionPassword}
                        onChange={(e) => setFormData({ ...formData, transactionPassword: e.target.value })}
                        className="pl-10 pr-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowTransactionPassword(!showTransactionPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                      >
                        {showTransactionPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-white/40">{getTransactionPasswordRequirementsText()}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmTransactionPassword" className="text-white/80">Confirm Transaction Password</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="confirmTransactionPassword"
                        type={showTransactionPassword ? 'text' : 'password'}
                        placeholder="Confirm transaction password"
                        value={formData.confirmTransactionPassword}
                        onChange={(e) => setFormData({ ...formData, confirmTransactionPassword: e.target.value })}
                        className="pl-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="country" className="text-white/80">Country</Label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <select
                        id="country"
                        value={formData.country}
                        onChange={(e) => handleCountryChange(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-[#1f2937] border border-white/10 rounded-md text-white focus:border-[#118bdd] focus:ring-[#118bdd]/20 appearance-none"
                      >
                        <option value="" className="bg-[#1f2937]">Select your country</option>
                        {countries.map((country) => (
                          <option key={country} value={country} className="bg-[#1f2937]">
                            {country}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-white/80">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="+1 234 567 8900"
                        value={formData.phone}
                        onChange={(e) => handlePhoneChange(e.target.value)}
                        className="pl-10 bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-white/10 bg-[#1f2937]/50 p-3">
                    <Label className="text-white/80">Email OTP Verification</Label>
                    <p className="text-xs text-white/50">
                      Verify using OTP sent to <span className="text-white/70">{formData.email || 'your email'}</span>
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={isSendingOtp}
                        className="w-full sm:w-auto btn-primary"
                      >
                        {isSendingOtp ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : otpSent ? 'Resend OTP' : 'Send OTP'}
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

                  <div className="flex items-center gap-2 text-sm">
                    <input type="checkbox" required className="rounded border-white/20 bg-[#1f2937]" />
                    <span className="text-white/60">
                      I agree to the <Link to="/terms-and-conditions" className="text-[#118bdd]">Terms & Conditions</Link>
                    </span>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBack}
                      className="flex-1 h-11 border-white/20 text-white hover:bg-white/10"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={isLoading || !otpVerified}
                      className="flex-1 btn-primary h-11"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Create Account
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </form>

            <div className="mt-6 text-center">
              <p className="text-white/60">
                Already have an account?{' '}
                <Link to="/login" className="text-[#118bdd] hover:text-[#38bdf5] font-medium">
                  Sign in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
