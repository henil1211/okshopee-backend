import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useOtpStore, useSyncRefreshKey } from '@/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MobileBottomNav from '@/components/MobileBottomNav';
import { ArrowLeft, UserCog, Mail, Phone, Shield, Key, RefreshCw, Eye, EyeOff, Globe } from 'lucide-react';
import { toast } from 'sonner';
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

export default function Profile() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, updateUser, verifyTransactionPassword } = useAuthStore();
  const { sendOtp, verifyOtp } = useOtpStore();

  const displayUser = impersonatedUser || user;
  const syncKey = useSyncRefreshKey();

  const [contactData, setContactData] = useState({
    email: '',
    newEmail: '',
    phone: '',
    newPhone: '',
    usdtAddress: '',
    newUsdtAddress: '',
    transactionPassword: '',
    otp: ''
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    otp: ''
  });

  const [txPasswordData, setTxPasswordData] = useState({
    currentTxPassword: '',
    newTxPassword: '',
    confirmTxPassword: '',
    otp: ''
  });

  const [sendingOtpFor, setSendingOtpFor] = useState<'contact' | 'password' | 'tx' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [forgotLoginPassword, setForgotLoginPassword] = useState(false);
  const [forgotTxPassword, setForgotTxPassword] = useState(false);
  const [showContactTxPass, setShowContactTxPass] = useState(false);
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [showCurrentTxPass, setShowCurrentTxPass] = useState(false);
  const [showNewTxPass, setShowNewTxPass] = useState(false);
  const [showConfirmTxPass, setShowConfirmTxPass] = useState(false);
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [showChangePhone, setShowChangePhone] = useState(false);
  const [showChangeUsdt, setShowChangeUsdt] = useState(false);
  const contactOtpResend = useOtpResend(30);
  const passwordOtpResend = useOtpResend(30);
  const txOtpResend = useOtpResend(30);
  const lastHydratedProfileUserIdRef = useRef<string>('');

  const applyDialCode = (value: string, countryName?: string | null) => {
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

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;

    const activeProfileUserId = String(displayUser.id || displayUser.userId || '').trim();
    const userChanged = !!activeProfileUserId && lastHydratedProfileUserIdRef.current !== activeProfileUserId;
    const nextPhone = applyDialCode(displayUser.phone || '', displayUser.country);
    const nextEmail = String(displayUser.email || '').trim();
    const nextUsdt = String(displayUser.usdtAddress || '').trim();

    setContactData((prev) => {
      const hasPendingDraft =
        prev.newEmail.trim().length > 0
        || prev.newPhone.trim().length > 0
        || prev.newUsdtAddress.trim().length > 0
        || prev.transactionPassword.trim().length > 0
        || prev.otp.trim().length > 0;

      if (!userChanged && hasPendingDraft) {
        return {
          ...prev,
          email: nextEmail,
          phone: nextPhone,
          usdtAddress: nextUsdt
        };
      }

      return {
        email: nextEmail,
        newEmail: '',
        phone: nextPhone,
        newPhone: '',
        usdtAddress: nextUsdt,
        newUsdtAddress: '',
        transactionPassword: '',
        otp: ''
      };
    });

    if (activeProfileUserId) {
      lastHydratedProfileUserIdRef.current = activeProfileUserId;
    }
  }, [
    displayUser?.id,
    displayUser?.userId,
    displayUser?.email,
    displayUser?.phone,
    displayUser?.usdtAddress,
    displayUser?.country,
    isAuthenticated,
    navigate,
    syncKey
  ]);

  const isContactChanging = showChangeEmail ||
    showChangePhone ||
    showChangeUsdt ||
    (!contactData.usdtAddress && contactData.newUsdtAddress.trim().length > 0);

  const handleSendOtp = async (purpose: 'contact' | 'password' | 'tx') => {
    if (!displayUser) return;
    const otpResend = purpose === 'contact'
      ? contactOtpResend
      : purpose === 'password'
        ? passwordOtpResend
        : txOtpResend;
    if (otpResend.isCoolingDown) return;

    // Always send OTP to the CURRENT registered email (not the new one)
    const selectedEmail = (displayUser.email || '').trim();

    if (!selectedEmail) {
      toast.error('Email is required to send OTP');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selectedEmail)) {
      toast.error('Enter a valid email address');
      return;
    }

    setSendingOtpFor(purpose);
    const result = await sendOtp(displayUser.userId, selectedEmail, 'profile_update');
    setSendingOtpFor(null);

    if (result.success) {
      otpResend.startCooldown();
      if (result.status === 'pending') {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } else {
      toast.error(result.message);
    }
  };

  const handleUpdateContact = async () => {
    if (!displayUser) return;
    const finalEmail = contactData.newEmail.trim() || contactData.email.trim();
    const finalPhone = contactData.newPhone.trim() || contactData.phone.trim();
    const finalUsdt = contactData.newUsdtAddress.trim() || contactData.usdtAddress.trim();

    if (!finalEmail || !finalPhone) {
      toast.error('Email and mobile are required');
      return;
    }
    if (contactData.newEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactData.newEmail.trim())) {
      toast.error('Enter a valid new email address');
      return;
    }
    if (contactData.newPhone.trim() && !isValidPhoneNumberForCountry(contactData.newPhone, displayUser.country)) {
      toast.error('Enter a valid new mobile number for your country');
      return;
    }
    if (!verifyTransactionPassword(displayUser.id, contactData.transactionPassword)) {
      toast.error('Invalid transaction password');
      return;
    }
    if (!contactData.otp) {
      toast.error('OTP is required');
      return;
    }
    const otpValid = await verifyOtp(displayUser.userId, contactData.otp, 'profile_update');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }

    const newLastActions = { ...(displayUser.lastActions || {}) };
    let hasContactChanges = false;

    if (finalEmail !== displayUser.email) {
      newLastActions.email = new Date().toISOString();
      hasContactChanges = true;
    }
    if (normalizePhoneNumber(finalPhone) !== displayUser.phone) {
      newLastActions.phone = new Date().toISOString();
      hasContactChanges = true;
    }
    if (finalUsdt !== displayUser.usdtAddress) {
      newLastActions.usdtAddress = new Date().toISOString();
      hasContactChanges = true;
    }

    setIsSaving(true);
    try {
      await updateUser({
        email: finalEmail,
        phone: normalizePhoneNumber(finalPhone),
        usdtAddress: finalUsdt,
        ...(hasContactChanges ? { lastActions: newLastActions } : {})
      });

      setContactData((prev) => ({
        ...prev,
        email: finalEmail,
        phone: applyDialCode(normalizePhoneNumber(finalPhone), displayUser.country),
        usdtAddress: finalUsdt,
        newEmail: '',
        newPhone: '',
        newUsdtAddress: '',
        transactionPassword: '',
        otp: ''
      }));
      setShowChangeEmail(false);
      setShowChangePhone(false);
      setShowChangeUsdt(false);
      toast.success('Profile contact details updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update profile contact details');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!displayUser) return;
    if (!forgotLoginPassword) {
      if (passwordData.currentPassword !== displayUser.password) {
        toast.error('Current password is incorrect');
        return;
      }
    }
    if (!passwordData.otp) {
      toast.error('OTP is required');
      return;
    }
    const otpValid = await verifyOtp(displayUser.userId, passwordData.otp, 'profile_update');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }
    if (!isStrongPassword(passwordData.newPassword)) {
      toast.error(getPasswordRequirementsText());
      return;
    }
    if (passwordData.newPassword === displayUser.password) {
      toast.error('New password cannot be same as current password');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Password confirmation does not match');
      return;
    }

    setIsSaving(true);
    try {
      await updateUser({
        password: passwordData.newPassword,
        lastActions: { ...(displayUser.lastActions || {}), loginPassword: new Date().toISOString() }
      });

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        otp: ''
      });
      setForgotLoginPassword(false);
      toast.success('Login password updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update login password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateTransactionPassword = async () => {
    if (!displayUser) return;
    if (!forgotTxPassword) {
      if (!verifyTransactionPassword(displayUser.id, txPasswordData.currentTxPassword)) {
        toast.error('Current transaction password is incorrect');
        return;
      }
    }
    if (!txPasswordData.otp) {
      toast.error('OTP is required');
      return;
    }
    const otpValid = await verifyOtp(displayUser.userId, txPasswordData.otp, 'profile_update');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }
    if (!isValidTransactionPassword(txPasswordData.newTxPassword)) {
      toast.error(getTransactionPasswordRequirementsText());
      return;
    }
    if (txPasswordData.newTxPassword === (displayUser.transactionPassword || '')) {
      toast.error('New transaction password cannot be same as current transaction password');
      return;
    }
    if (txPasswordData.newTxPassword !== txPasswordData.confirmTxPassword) {
      toast.error('Transaction password confirmation does not match');
      return;
    }

    setIsSaving(true);
    try {
      await updateUser({
        transactionPassword: txPasswordData.newTxPassword,
        lastActions: { ...(displayUser.lastActions || {}), transactionPassword: new Date().toISOString() }
      });

      setTxPasswordData({
        currentTxPassword: '',
        newTxPassword: '',
        confirmTxPassword: '',
        otp: ''
      });
      setForgotTxPassword(false);
      toast.success('Transaction password updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update transaction password');
    } finally {
      setIsSaving(false);
    }
  };

  if (!displayUser) return null;

  return (
    <div className="profile-page min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="min-h-16 py-2 sm:py-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#004e9a] flex items-center justify-center">
                <UserCog className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold">My Profile</p>
                <p className="text-xs text-white/50">ID: {displayUser.userId}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">

        {/* User Info Card */}
        <Card className="glass border-white/10 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-[#118bdd]/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#118bdd]/20 to-purple-500/20 border border-white/10 flex items-center justify-center shrink-0">
                  <UserCog className="w-8 h-8 text-[#118bdd]" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1 tracking-tight">{displayUser.fullName}</h2>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-[#118bdd] bg-[#118bdd]/10 px-2 py-0.5 rounded border border-[#118bdd]/20">ID: {displayUser.userId}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Contact and USDT Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-white/80">Email</Label>
                  <button
                    type="button"
                    onClick={() => { setShowChangeEmail(!showChangeEmail); if (showChangeEmail) setContactData(prev => ({ ...prev, newEmail: '' })); }}
                    className="text-xs text-[#118bdd] hover:text-[#7dd3fc] transition-colors"
                  >
                    {showChangeEmail ? 'Cancel' : 'Change Email'}
                  </button>
                </div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    value={contactData.email}
                    disabled
                    className="pl-10 bg-[#1f2937]/50 border-white/5 text-white/50 cursor-not-allowed"
                  />
                </div>
                {displayUser.lastActions?.email && (
                  <p className="text-[10px] text-[#118bdd] mt-1">Last updated: {new Date(displayUser.lastActions.email).toLocaleString()}</p>
                )}
                {showChangeEmail && (
                  <div className="relative mt-2">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400/60" />
                    <Input
                      value={contactData.newEmail}
                      onChange={(e) => setContactData({ ...contactData, newEmail: e.target.value })}
                      placeholder="Enter new email"
                      className="pl-10 bg-[#1f2937] border-amber-500/30 text-white focus:border-amber-400"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-white/80">Country</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    value={displayUser?.country || 'Not set'}
                    disabled
                    className="pl-10 bg-[#1f2937]/50 border-white/5 text-white/50 cursor-not-allowed"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-white/80">Mobile Number</Label>
                  <button
                    type="button"
                    onClick={() => { setShowChangePhone(!showChangePhone); if (showChangePhone) setContactData(prev => ({ ...prev, newPhone: '' })); }}
                    className="text-xs text-[#118bdd] hover:text-[#7dd3fc] transition-colors"
                  >
                    {showChangePhone ? 'Cancel' : 'Change Number'}
                  </button>
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    value={contactData.phone}
                    disabled
                    className="pl-10 bg-[#1f2937]/50 border-white/5 text-white/50 cursor-not-allowed"
                  />
                </div>
                {displayUser.lastActions?.phone && (
                  <p className="text-[10px] text-[#118bdd] mt-1">Last updated: {new Date(displayUser.lastActions.phone).toLocaleString()}</p>
                )}
                {showChangePhone && (
                  <div className="relative mt-2">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400/60" />
                    <Input
                      value={contactData.newPhone}
                      onChange={(e) => setContactData({ ...contactData, newPhone: applyDialCode(e.target.value, displayUser?.country) })}
                      placeholder="Enter new mobile number"
                      className="pl-10 bg-[#1f2937] border-amber-500/30 text-white focus:border-amber-400"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-white/80">USDT (BEP20) Address</Label>
                {contactData.usdtAddress && (
                  <button
                    type="button"
                    onClick={() => { setShowChangeUsdt(!showChangeUsdt); if (showChangeUsdt) setContactData(prev => ({ ...prev, newUsdtAddress: '' })); }}
                    className="text-xs text-[#118bdd] hover:text-[#7dd3fc] transition-colors"
                  >
                    {showChangeUsdt ? 'Cancel' : 'Change USDT (BEP20) Address'}
                  </button>
                )}
              </div>
              {!contactData.usdtAddress ? (
                <Input
                  value={contactData.newUsdtAddress}
                  onChange={(e) => setContactData({ ...contactData, newUsdtAddress: e.target.value })}
                  placeholder="Enter USDT (BEP20) address"
                  className="bg-[#1f2937] border-amber-500/30 text-white focus:border-amber-400"
                />
              ) : (
                <>
                  <div className="space-y-1">
                    <Input
                      value={contactData.usdtAddress}
                      disabled
                      placeholder="No USDT address set"
                      className="bg-[#1f2937]/50 border-white/5 text-white/50 cursor-not-allowed"
                    />
                    {displayUser.lastActions?.usdtAddress && (
                      <p className="text-[10px] text-[#118bdd]">Last updated: {new Date(displayUser.lastActions.usdtAddress).toLocaleString()}</p>
                    )}
                  </div>
                  {showChangeUsdt && (
                    <Input
                      value={contactData.newUsdtAddress}
                      onChange={(e) => setContactData({ ...contactData, newUsdtAddress: e.target.value })}
                      placeholder="Enter new USDT address"
                      className="bg-[#1f2937] border-amber-500/30 text-white focus:border-amber-400 mt-2"
                    />
                  )}
                </>
              )}
            </div>
            {isContactChanging && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/80">Transaction Password</Label>
                    <div className="relative">
                      <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <Input
                        type={showContactTxPass ? 'text' : 'password'}
                        value={contactData.transactionPassword}
                        onChange={(e) => setContactData({ ...contactData, transactionPassword: e.target.value })}
                        placeholder="Required for this action"
                        className="pl-10 pr-10 bg-[#1f2937] border-white/10 text-white"
                      />
                      <button type="button" onClick={() => setShowContactTxPass(!showContactTxPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                        {showContactTxPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/80">Email OTP</Label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={contactData.otp}
                        onChange={(e) => setContactData({ ...contactData, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                        placeholder="Enter OTP"
                        maxLength={6}
                        className="bg-[#1f2937] border-white/10 text-white"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleSendOtp('contact')}
                        disabled={sendingOtpFor === 'contact' || contactOtpResend.isCoolingDown}
                        className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
                      >
                        {sendingOtpFor === 'contact'
                          ? <RefreshCw className="w-4 h-4 animate-spin" />
                          : contactOtpResend.isCoolingDown
                            ? `Resend in ${contactOtpResend.remainingSeconds}s`
                            : 'Send OTP'}
                      </Button>
                    </div>
                  </div>
                </div>
                <Button onClick={handleUpdateContact} disabled={isSaving} className="btn-primary">
                  Save Contact Details
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">Change Login Password</CardTitle>
              <Button
                type="button"
                variant="link"
                onClick={() => { setForgotLoginPassword(!forgotLoginPassword); setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '', otp: '' }); }}
                className="text-amber-400 hover:text-amber-300 p-0 h-auto text-sm"
              >
                {forgotLoginPassword ? 'I know my password' : 'Forgot Password?'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400">
                {forgotLoginPassword
                  ? 'Enter your new password and verify with OTP sent to your registered email.'
                  : 'Enter your current password, new password, and verify with OTP sent to your registered email.'}
              </p>
            </div>
            <div className={`grid grid-cols-1 ${forgotLoginPassword ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4`}>
              {!forgotLoginPassword && (
                <div className="relative">
                  <Input
                    type={showCurrentPass ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    placeholder="Current password"
                    className="pr-10 bg-[#1f2937] border-white/10 text-white"
                  />
                  <button type="button" onClick={() => setShowCurrentPass(!showCurrentPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                    {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              )}
              <div className="relative">
                <Input
                  type={showNewPass ? 'text' : 'password'}
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  placeholder="New password"
                  className="pr-10 bg-[#1f2937] border-white/10 text-white"
                />
                <button type="button" onClick={() => setShowNewPass(!showNewPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <Input
                  type={showConfirmPass ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  placeholder="Confirm new password"
                  className="pr-10 bg-[#1f2937] border-white/10 text-white"
                />
                <button type="button" onClick={() => setShowConfirmPass(!showConfirmPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-white/40">{getPasswordRequirementsText()}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={passwordData.otp}
                onChange={(e) => setPasswordData({ ...passwordData, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                maxLength={6}
                placeholder="Email OTP"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSendOtp('password')}
                disabled={sendingOtpFor === 'password' || passwordOtpResend.isCoolingDown}
                className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
              >
                {sendingOtpFor === 'password'
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : passwordOtpResend.isCoolingDown
                    ? `Resend in ${passwordOtpResend.remainingSeconds}s`
                    : 'Send OTP'}
              </Button>
            </div>
            <div className="space-y-1">
              <Button onClick={handleUpdatePassword} disabled={isSaving} className="btn-primary w-full sm:w-auto">
                Update Login Password
              </Button>
              {displayUser.lastActions?.loginPassword && (
                <p className="text-[10px] text-[#118bdd]">Last updated: {new Date(displayUser.lastActions.loginPassword).toLocaleString()}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">Change Transaction Password</CardTitle>
              <Button
                type="button"
                variant="link"
                onClick={() => { setForgotTxPassword(!forgotTxPassword); setTxPasswordData({ currentTxPassword: '', newTxPassword: '', confirmTxPassword: '', otp: '' }); }}
                className="text-amber-400 hover:text-amber-300 p-0 h-auto text-sm"
              >
                {forgotTxPassword ? 'I know my password' : 'Forgot Password?'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400">
                {forgotTxPassword
                  ? 'Enter your new transaction password and verify with OTP sent to your registered email.'
                  : 'Enter your current transaction password, new password, and verify with OTP sent to your registered email.'}
              </p>
            </div>
            <div className={`grid grid-cols-1 ${forgotTxPassword ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4`}>
              {!forgotTxPassword && (
                <div className="relative">
                  <Input
                    type={showCurrentTxPass ? 'text' : 'password'}
                    value={txPasswordData.currentTxPassword}
                    onChange={(e) => setTxPasswordData({ ...txPasswordData, currentTxPassword: e.target.value })}
                    placeholder="Current transaction password"
                    className="pr-10 bg-[#1f2937] border-white/10 text-white"
                  />
                  <button type="button" onClick={() => setShowCurrentTxPass(!showCurrentTxPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                    {showCurrentTxPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              )}
              <div className="relative">
                <Input
                  type={showNewTxPass ? 'text' : 'password'}
                  value={txPasswordData.newTxPassword}
                  onChange={(e) => setTxPasswordData({ ...txPasswordData, newTxPassword: e.target.value })}
                  placeholder="New transaction password"
                  className="pr-10 bg-[#1f2937] border-white/10 text-white"
                />
                <button type="button" onClick={() => setShowNewTxPass(!showNewTxPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showNewTxPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <Input
                  type={showConfirmTxPass ? 'text' : 'password'}
                  value={txPasswordData.confirmTxPassword}
                  onChange={(e) => setTxPasswordData({ ...txPasswordData, confirmTxPassword: e.target.value })}
                  placeholder="Confirm new transaction password"
                  className="pr-10 bg-[#1f2937] border-white/10 text-white"
                />
                <button type="button" onClick={() => setShowConfirmTxPass(!showConfirmTxPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showConfirmTxPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-white/40">{getTransactionPasswordRequirementsText()}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={txPasswordData.otp}
                onChange={(e) => setTxPasswordData({ ...txPasswordData, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                maxLength={6}
                placeholder="Email OTP"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSendOtp('tx')}
                disabled={sendingOtpFor === 'tx' || txOtpResend.isCoolingDown}
                className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
              >
                {sendingOtpFor === 'tx'
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : txOtpResend.isCoolingDown
                    ? `Resend in ${txOtpResend.remainingSeconds}s`
                    : 'Send OTP'}
              </Button>
            </div>
            <div className="space-y-1">
              <Button onClick={handleUpdateTransactionPassword} disabled={isSaving} className="btn-primary w-full sm:w-auto">
                <Key className="w-4 h-4 mr-2" />
                Update Transaction Password
              </Button>
              {displayUser.lastActions?.transactionPassword && (
                <p className="text-[10px] text-[#118bdd]">Last updated: {new Date(displayUser.lastActions.transactionPassword).toLocaleString()}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
      <MobileBottomNav />
    </div>
  );
}
