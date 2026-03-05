import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useOtpStore, usePinStore } from '@/store';
import Database from '@/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import MobileBottomNav from '@/components/MobileBottomNav';
import { ArrowLeft, CheckCircle, Loader2, UserPlus } from 'lucide-react';
import { isValidPhoneNumber, normalizePhoneNumber } from '@/utils/helpers';

export default function CreateId() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, register } = useAuthStore();
  const { sendOtp, verifyOtp } = useOtpStore();
  const { unusedPins, loadPins } = usePinStore();
  const displayUser = impersonatedUser || user;

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
  const [sponsorName, setSponsorName] = useState('');
  const [error, setError] = useState('');
  const [successUserId, setSuccessUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;
    loadPins(displayUser.id);
    setFormData(prev => ({ ...prev, sponsorId: displayUser.userId }));
    setSponsorName(displayUser.fullName);
  }, [displayUser, isAuthenticated, loadPins, navigate]);

  const handleSponsorIdChange = (value: string) => {
    const cleanValue = value.replace(/\D/g, '').slice(0, 7);
    setFormData(prev => ({ ...prev, sponsorId: cleanValue }));
    if (cleanValue.length === 7) {
      const sponsor = Database.getUserByUserId(cleanValue);
      setSponsorName(sponsor?.fullName || '');
    } else {
      setSponsorName('');
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

  const handlePhoneChange = (value: string) => {
    setFormData((prev) => ({ ...prev, phone: value }));
    resetOtpFlow();
  };

  const getCreateIdOtpKey = () => `createid_${formData.email.trim().toLowerCase()}`;

  const handleSendOtp = async () => {
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError('Enter a valid email before sending OTP');
      return;
    }
    if (!isValidPhoneNumber(formData.phone)) {
      setError('Enter a valid mobile number before sending OTP');
      return;
    }

    setIsSendingOtp(true);
    const result = await sendOtp(getCreateIdOtpKey(), formData.email.trim(), 'registration');
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
    if (!isValidPhoneNumber(formData.phone)) return 'Enter a valid mobile number (8-15 digits)';
    if (!formData.country.trim()) return 'Country is required';
    if (!formData.sponsorId || formData.sponsorId.length !== 7) return 'Valid sponsor ID is required';
    if (!sponsorName) return 'Sponsor ID not found';
    if (!formData.pinCode) return 'Please select a PIN';
    if (!unusedPins.some(p => p.pinCode === formData.pinCode)) return 'Selected PIN is not available';
    if (formData.password.length < 6) return 'Password must be at least 6 characters';
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match';
    if (formData.transactionPassword.length < 4) return 'Transaction password must be at least 4 characters';
    if (formData.transactionPassword !== formData.confirmTransactionPassword) return 'Transaction passwords do not match';
    if (!otpVerified) return 'Verify OTP sent to email before creating ID';
    if (!formData.agreeTerms) return 'Please accept terms and conditions';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessUserId('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsLoading(true);

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

    setIsLoading(false);
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
    resetOtpFlow();
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
              <Alert className="mb-4 bg-emerald-500/10 border-emerald-500/30">
                <AlertDescription className="text-emerald-400 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  New ID created successfully: {successUserId}
                </AlertDescription>
              </Alert>
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
                  <Label className="text-white/80">Mobile Number</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Country</Label>
                  <Input
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Sponsor ID</Label>
                  <Input
                    value={formData.sponsorId}
                    onChange={(e) => handleSponsorIdChange(e.target.value)}
                    maxLength={7}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                  {sponsorName && (
                    <p className="text-xs text-emerald-400">Sponsor: {sponsorName}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">PIN Dropdown</Label>
                  <select
                    value={formData.pinCode}
                    onChange={(e) => setFormData({ ...formData, pinCode: e.target.value })}
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
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Password</Label>
                  <Input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Confirm Password</Label>
                  <Input
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white/80">Transaction Password</Label>
                  <Input
                    type="password"
                    value={formData.transactionPassword}
                    onChange={(e) => setFormData({ ...formData, transactionPassword: e.target.value })}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Confirm Transaction Password</Label>
                  <Input
                    type="password"
                    value={formData.confirmTransactionPassword}
                    onChange={(e) => setFormData({ ...formData, confirmTransactionPassword: e.target.value })}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
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
