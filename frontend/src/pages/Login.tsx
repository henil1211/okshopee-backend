import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Eye, EyeOff, Loader2, Lock, ArrowRight, 
  Shield, Users, TrendingUp, Wallet, IdCard
} from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import PublicFooter from '@/components/PublicFooter';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [formData, setFormData] = useState({
    userId: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted ? resolvedTheme === 'dark' : true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Validate 7-digit ID
    if (!/^\d{7}$/.test(formData.userId)) {
      setError('User ID must be exactly 7 digits');
      setIsLoading(false);
      return;
    }

    try {
      const result = await login(formData.userId, formData.password);
      if (result.success) {
        const user = useAuthStore.getState().user;
        if (user?.isAdmin) {
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      } else {
        setError(result.message);
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: Users, text: 'Digital Referral Network' },
    { icon: Wallet, text: 'Smart Shopping Rewards' },
    { icon: TrendingUp, text: 'Save + Earn Model' },
    { icon: Shield, text: 'Transparent Reward Structure' }
  ];

  return (
    <div className="min-h-svh bg-[#0a0e17] text-white flex flex-col">
      <div className="flex-1 lg:grid lg:grid-cols-2">
      {/* Left Side - Features */}
      <div className="login-feature-panel relative hidden overflow-hidden lg:flex">
        <div className={`absolute inset-0 bg-gradient-to-br ${isDarkMode ? 'from-[#03162d] via-[#0a3d6f] to-[#020617]' : 'from-[#e6f2ff] via-[#c9e5ff] to-[#f7fbff]'}`}>
          <div className={`absolute inset-0 network-bg ${isDarkMode ? 'opacity-30' : 'opacity-40'}`} />
          {isDarkMode && <div className="absolute inset-0 bg-[#020617]/45" />}
          
          {/* Animated Circles */}
          <div className={`absolute top-20 left-20 w-64 h-64 rounded-full blur-3xl animate-pulse ${isDarkMode ? 'bg-white/10' : 'bg-[#118bdd]/20'}`} />
          <div
            className={`absolute bottom-20 right-20 w-96 h-96 rounded-full blur-3xl animate-pulse ${isDarkMode ? 'bg-[#118bdd]/20' : 'bg-[#118bdd]/25'}`}
            style={{ animationDelay: '1s' }}
          />
        </div>
        
        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col justify-center px-10 py-16 xl:px-16">
          <div className="mb-8">
            <div className="mb-6">
              <BrandLogo variant="full" className="h-14 w-[236px] rounded-md" />
            </div>
            <h1 className={`text-4xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              Welcome to the Future of<br />
              <span className={isDarkMode ? 'text-[#bfe6ff]' : 'text-[#0a5c9d]'}>Smart Shopping and Referral Rewards</span>
            </h1>
            <p className={`text-lg max-w-md ${isDarkMode ? 'text-white/85' : 'text-slate-700'}`}>
              ReferNex helps you shop smarter, earn smarter, and grow through a community-driven referral network.
            </p>
          </div>
          
          <div className="space-y-4">
            {features.map((feature, index) => (
              <div 
                key={index}
                className={`flex items-center gap-4 p-4 rounded-xl backdrop-blur-sm border ${
                  isDarkMode
                    ? 'bg-[#0a223d]/72 border-[#7cc9ff]/30'
                    : 'bg-white/70 border-[#118bdd]/20'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-[#113459]' : 'bg-[#118bdd]/15'}`}>
                  <feature.icon className={`w-5 h-5 ${isDarkMode ? 'text-[#c8ebff]' : 'text-[#0a5c9d]'}`} />
                </div>
                <span className={`font-medium ${isDarkMode ? 'text-white/95' : 'text-slate-800'}`}>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex w-full items-center justify-center bg-[#0a0e17] px-4 py-6 sm:px-8 sm:py-10">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
            <BrandLogo variant="full" className="h-10 w-[168px] rounded-md" />
          </div>

          <Card className="glass rounded-2xl border-white/10">
            <CardHeader className="space-y-1 px-5 pb-2 pt-5 sm:px-6 sm:pt-6">
              <CardTitle className="text-2xl font-bold text-white text-center">
                Sign In
              </CardTitle>
              <CardDescription className="text-center text-white/60">
                Enter your 7-digit ReferNex ID and password
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
              {error && (
                <Alert variant="destructive" className="mb-4 bg-red-500/10 border-red-500/30">
                  <AlertDescription className="text-red-400">{error}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="userId" className="text-white/80">User ID (7 digits)</Label>
                  <div className="relative">
                    <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <Input
                      id="userId"
                      type="text"
                      maxLength={7}
                      placeholder="Enter 7-digit ID (e.g., 1000001)"
                      value={formData.userId}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 7);
                        setFormData({ ...formData, userId: value });
                      }}
                      className="h-11 pl-10 text-base bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-white/80">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="h-11 pl-10 pr-10 text-base bg-[#1f2937] border-white/10 text-white placeholder:text-white/40 focus:border-[#118bdd] focus:ring-[#118bdd]/20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-2 text-white/60">
                    <input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-[#1f2937]" />
                    Remember me
                  </label>
                  <Link to="/forgot-password" className="text-[#118bdd] hover:text-[#38bdf5]">
                    Forgot password?
                  </Link>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full btn-primary h-11 text-base"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-white/60">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-[#118bdd] hover:text-[#38bdf5] font-medium">
                    Create one
                  </Link>
                </p>
              </div>

            </CardContent>
          </Card>
        </div>
      </div>
      </div>
      <PublicFooter />
    </div>
  );
}


