import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useOtpStore } from '@/store';
import Database from '@/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, UserCog, Mail, Phone, Shield, Key, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function Profile() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, updateUser, verifyTransactionPassword } = useAuthStore();
  const { sendOtp, verifyOtp } = useOtpStore();

  const displayUser = impersonatedUser || user;

  const [contactData, setContactData] = useState({
    email: '',
    phone: '',
    usdtAddress: '',
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

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;
    setContactData({
      email: displayUser.email,
      phone: displayUser.phone || '',
      usdtAddress: displayUser.usdtAddress || '',
      transactionPassword: '',
      otp: ''
    });
  }, [displayUser, isAuthenticated, navigate]);

  const handleSendOtp = async (purpose: 'contact' | 'password' | 'tx') => {
    if (!displayUser) return;
    setSendingOtpFor(purpose);
    const result = await sendOtp(displayUser.id, displayUser.email, 'profile_update');
    setSendingOtpFor(null);

    if (result.success) {
      toast.success('OTP sent to your registered email');
    } else {
      toast.error(result.message);
    }
  };

  const handleUpdateContact = async () => {
    if (!displayUser) return;
    if (!contactData.email.trim() || !contactData.phone.trim()) {
      toast.error('Email and mobile are required');
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
    const otpValid = await verifyOtp(displayUser.id, contactData.otp, 'profile_update');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }

    const existingUser = Database.getUserByEmail(contactData.email);
    if (existingUser && existingUser.id !== displayUser.id) {
      toast.error('Email already exists');
      return;
    }

    setIsSaving(true);
    updateUser({
      email: contactData.email.trim(),
      phone: contactData.phone.trim(),
      usdtAddress: contactData.usdtAddress.trim()
    });
    setIsSaving(false);

    setContactData(prev => ({ ...prev, transactionPassword: '', otp: '' }));
    toast.success('Profile contact details updated');
  };

  const handleUpdatePassword = async () => {
    if (!displayUser) return;
    if (passwordData.currentPassword !== displayUser.password) {
      toast.error('Current password is incorrect');
      return;
    }
    if (passwordData.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Password confirmation does not match');
      return;
    }
    if (!passwordData.otp) {
      toast.error('OTP is required');
      return;
    }
    const otpValid = await verifyOtp(displayUser.id, passwordData.otp, 'profile_update');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }

    setIsSaving(true);
    updateUser({ password: passwordData.newPassword });
    setIsSaving(false);

    setPasswordData({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      otp: ''
    });
    toast.success('Login password updated');
  };

  const handleUpdateTransactionPassword = async () => {
    if (!displayUser) return;
    if (!verifyTransactionPassword(displayUser.id, txPasswordData.currentTxPassword)) {
      toast.error('Current transaction password is incorrect');
      return;
    }
    if (txPasswordData.newTxPassword.length < 4) {
      toast.error('New transaction password must be at least 4 characters');
      return;
    }
    if (txPasswordData.newTxPassword !== txPasswordData.confirmTxPassword) {
      toast.error('Transaction password confirmation does not match');
      return;
    }
    if (!txPasswordData.otp) {
      toast.error('OTP is required');
      return;
    }
    const otpValid = await verifyOtp(displayUser.id, txPasswordData.otp, 'profile_update');
    if (!otpValid) {
      toast.error('Invalid or expired OTP');
      return;
    }

    setIsSaving(true);
    updateUser({ transactionPassword: txPasswordData.newTxPassword });
    setIsSaving(false);

    setTxPasswordData({
      currentTxPassword: '',
      newTxPassword: '',
      confirmTxPassword: '',
      otp: ''
    });
    toast.success('Transaction password updated');
  };

  if (!displayUser) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17]">
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
        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Contact and USDT Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-white/80">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    value={contactData.email}
                    onChange={(e) => setContactData({ ...contactData, email: e.target.value })}
                    className="pl-10 bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-white/80">Mobile Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    value={contactData.phone}
                    onChange={(e) => setContactData({ ...contactData, phone: e.target.value })}
                    className="pl-10 bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-white/80">USDT (BEP20) Address</Label>
              <Input
                value={contactData.usdtAddress}
                onChange={(e) => setContactData({ ...contactData, usdtAddress: e.target.value })}
                placeholder="Enter your USDT address"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-white/80">Transaction Password</Label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input
                    type="password"
                    value={contactData.transactionPassword}
                    onChange={(e) => setContactData({ ...contactData, transactionPassword: e.target.value })}
                    placeholder="Required for this action"
                    className="pl-10 bg-[#1f2937] border-white/10 text-white"
                  />
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
                    disabled={sendingOtpFor === 'contact'}
                    className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
                  >
                    {sendingOtpFor === 'contact' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Send OTP'}
                  </Button>
                </div>
              </div>
            </div>
            <Button onClick={handleUpdateContact} disabled={isSaving} className="btn-primary">
              Save Contact Details
            </Button>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Change Login Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                type="password"
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                placeholder="Current password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <Input
                type="password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                placeholder="New password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <Input
                type="password"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                placeholder="Confirm new password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
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
                disabled={sendingOtpFor === 'password'}
                className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
              >
                {sendingOtpFor === 'password' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Send OTP'}
              </Button>
            </div>
            <Button onClick={handleUpdatePassword} disabled={isSaving} className="btn-primary">
              Update Login Password
            </Button>
          </CardContent>
        </Card>

        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Change Transaction Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                type="password"
                value={txPasswordData.currentTxPassword}
                onChange={(e) => setTxPasswordData({ ...txPasswordData, currentTxPassword: e.target.value })}
                placeholder="Current transaction password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <Input
                type="password"
                value={txPasswordData.newTxPassword}
                onChange={(e) => setTxPasswordData({ ...txPasswordData, newTxPassword: e.target.value })}
                placeholder="New transaction password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
              <Input
                type="password"
                value={txPasswordData.confirmTxPassword}
                onChange={(e) => setTxPasswordData({ ...txPasswordData, confirmTxPassword: e.target.value })}
                placeholder="Confirm new transaction password"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>
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
                disabled={sendingOtpFor === 'tx'}
                className="border-white/20 text-white hover:bg-white/10 w-full sm:w-auto"
              >
                {sendingOtpFor === 'tx' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Send OTP'}
              </Button>
            </div>
            <Button onClick={handleUpdateTransactionPassword} disabled={isSaving} className="btn-primary">
              <Key className="w-4 h-4 mr-2" />
              Update Transaction Password
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
