import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, KeyRound, Mail, Shield } from 'lucide-react';
import { toast } from 'sonner';
import Database from '@/db';
import { useOtpStore } from '@/store';
import PublicFooter from '@/components/PublicFooter';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { sendOtp, verifyOtp } = useOtpStore();

  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const handleSendOtp = async () => {
    setError('');
    const user = Database.getUserByUserId(userId);
    if (!user) {
      setError('User ID not found');
      return;
    }
    if (user.email.toLowerCase() !== email.trim().toLowerCase()) {
      setError('Email does not match this User ID');
      return;
    }

    setIsSendingOtp(true);
    const result = await sendOtp(user.id, user.email, 'profile_update');
    setIsSendingOtp(false);
    if (result.success) {
      setOtpSent(true);
      toast.success('OTP sent to your email');
    } else {
      setError(result.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const user = Database.getUserByUserId(userId);
    if (!user) {
      setError('User ID not found');
      return;
    }
    if (!otp) {
      setError('OTP is required');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsResetting(true);
    const validOtp = await verifyOtp(user.id, otp, 'profile_update');
    if (!validOtp) {
      setIsResetting(false);
      setError('Invalid or expired OTP');
      return;
    }

    try {
      await Database.commitCriticalAction(() => Database.updateUser(user.id, { password: newPassword }));
      setIsResetting(false);
      toast.success('Password updated successfully');
      navigate('/login');
    } catch (error) {
      setIsResetting(false);
      setError(error instanceof Error ? error.message : 'Failed to update password');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
      <Card className="glass border-white/10 w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#118bdd]" />
            Reset Password
          </CardTitle>
          <CardDescription className="text-white/60">
            Verify your identity using email OTP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4 bg-red-500/10 border-red-500/30">
              <AlertDescription className="text-red-400">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white/80">User ID</Label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value.replace(/\D/g, '').slice(0, 7))}
                maxLength={7}
                placeholder="Enter 7-digit User ID"
                className="bg-[#1f2937] border-white/10 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-white/80">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter registered email"
                  className="pl-10 bg-[#1f2937] border-white/10 text-white"
                />
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleSendOtp}
              disabled={isSendingOtp || userId.length !== 7 || !email}
              className="w-full border-white/20 text-white hover:bg-white/10"
            >
              {isSendingOtp ? 'Sending OTP...' : 'Send OTP'}
            </Button>

            {otpSent && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-white/80">OTP</Label>
                  <div className="relative">
                    <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <Input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      placeholder="Enter 6-digit OTP"
                      className="pl-10 bg-[#1f2937] border-white/10 text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-white/80">New Password</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-white/80">Confirm Password</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isResetting}
                  className="w-full btn-primary"
                >
                  {isResetting ? 'Updating...' : 'Reset Password'}
                </Button>
              </div>
            )}
          </form>

          <Link to="/login" className="mt-4 inline-flex items-center gap-2 text-sm text-[#118bdd] hover:text-[#38bdf5]">
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </Link>
        </CardContent>
      </Card>
      </div>
      <PublicFooter />
    </div>
  );
}
