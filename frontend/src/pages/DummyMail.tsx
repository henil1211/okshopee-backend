import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import PublicFooter from '@/components/PublicFooter';

type SendMailResult = {
  ok: boolean;
  error?: string;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
};

const BACKEND_URL = (() => {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL;
  const fallback = typeof window !== 'undefined' ? window.location.origin : '';
  return (configured || fallback).replace(/\/+$/, '');
})();

export default function DummyMail() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('Dummy SMTP Mail');
  const [text, setText] = useState('This is a dummy email sent from the Dummy Mail page.');
  const [from, setFrom] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<SendMailResult | null>(null);

  const canSubmit = useMemo(
    () => to.trim().length > 0 && subject.trim().length > 0 && text.trim().length > 0,
    [to, subject, text]
  );

  const handleSendDummyMail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSending(true);
    setResult(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/send-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          text: text.trim(),
          from: from.trim() || undefined
        })
      });

      const payload = await response.json() as SendMailResult;
      if (!response.ok) {
        setResult({
          ok: false,
          error: payload.error || `Request failed with HTTP ${response.status}`
        });
        return;
      }

      setResult({
        ok: true,
        messageId: payload.messageId,
        accepted: payload.accepted || [],
        rejected: payload.rejected || []
      });
    } catch {
      setResult({
        ok: false,
        error: `Could not reach backend at ${BACKEND_URL}. Make sure backend is running.`
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="glass border-white/10 w-full max-w-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#118bdd]" />
              Dummy Mail Sender
            </CardTitle>
            <CardDescription className="text-white/60">
              Send a test email through SMTP using backend API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result && !result.ok && (
              <Alert variant="destructive" className="mb-4 bg-red-500/10 border-red-500/30">
                <AlertDescription className="text-red-300">{result.error}</AlertDescription>
              </Alert>
            )}

            {result?.ok && (
              <Alert className="mb-4 bg-emerald-500/10 border-emerald-500/30">
                <AlertDescription className="text-emerald-300">
                  Mail sent successfully. Message ID: {result.messageId || '-'}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSendDummyMail} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white/80">To</Label>
                <Input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="receiver@example.com"
                  className="bg-[#1f2937] border-white/10 text-white"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Dummy SMTP Mail"
                  className="bg-[#1f2937] border-white/10 text-white"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Message</Label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  placeholder="Write your test message"
                  className="w-full rounded-md border border-white/10 bg-[#1f2937] p-3 text-white placeholder:text-white/40 outline-none focus:border-[#118bdd]"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">From (optional)</Label>
                <Input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="leave blank to use SMTP_FROM from backend env"
                  className="bg-[#1f2937] border-white/10 text-white"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  type="submit"
                  disabled={!canSubmit || isSending}
                  className="btn-primary w-full sm:w-auto"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSending ? 'Sending...' : 'Send Dummy Mail'}
                </Button>
                <Link to="/admin" className="w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-white/20 text-white hover:bg-white/10"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Admin
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      <PublicFooter />
    </div>
  );
}
