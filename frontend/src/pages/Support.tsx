import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, LogOut, Paperclip, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore } from '@/store';
import Database from '@/db';
import type {
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus
} from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import MobileBottomNav from '@/components/MobileBottomNav';

const CATEGORY_OPTIONS: Array<{ value: SupportTicketCategory; label: string }> = [
  { value: 'account_issues', label: 'Account Issues' },
  { value: 'deposit_payment_issues', label: 'Deposit / Payment Issues' },
  { value: 'withdrawal_issues', label: 'Withdrawal Issues' },
  { value: 'referral_matrix_issues', label: 'Referral / Matrix Issues' },
  { value: 'technical_issues', label: 'Technical Issues' }
];

const PRIORITY_OPTIONS: Array<{ value: SupportTicketPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
];

const statusLabelMap: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_user_response: 'Awaiting User Response',
  resolved: 'Resolved',
  closed: 'Closed'
};

const statusClassMap: Record<SupportTicketStatus, string> = {
  open: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  in_progress: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  awaiting_user_response: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  resolved: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  closed: 'bg-gray-500/20 text-gray-300 border-gray-500/30'
};

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function toAttachment(file: File, uploadedBy: string): Promise<SupportTicketAttachment> {
  const dataUrl = await toDataUrl(file);
  return {
    id: `support_att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    file_name: file.name,
    file_type: file.type || 'application/octet-stream',
    file_size: file.size,
    data_url: dataUrl,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString()
  };
}

export default function Support() {
  const navigate = useNavigate();
  const { user, impersonatedUser, isAuthenticated, logout } = useAuthStore();
  const displayUser = impersonatedUser || user;

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [submitAttachment, setSubmitAttachment] = useState<SupportTicketAttachment | null>(null);
  const [replyAttachment, setReplyAttachment] = useState<SupportTicketAttachment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [formData, setFormData] = useState({
    category: 'technical_issues' as SupportTicketCategory,
    priority: 'medium' as SupportTicketPriority,
    subject: '',
    description: '',
    name: '',
    email: ''
  });
  const [replyMessage, setReplyMessage] = useState('');

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.ticket_id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  const loadTickets = () => {
    if (!displayUser) return;
    const rows = Database.getUserSupportTickets(displayUser.userId);
    setTickets(rows);
    if (!selectedTicketId && rows.length > 0) {
      setSelectedTicketId(rows[0].ticket_id);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!displayUser) return;
    setFormData((prev) => ({
      ...prev,
      name: prev.name || displayUser.fullName || '',
      email: prev.email || displayUser.email || ''
    }));
    loadTickets();
  }, [isAuthenticated, displayUser, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const handleSubmitFile = async (file: File | null) => {
    if (!file || !displayUser) {
      setSubmitAttachment(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Attachment size must be under 5MB');
      return;
    }
    const attachment = await toAttachment(file, displayUser.userId);
    setSubmitAttachment(attachment);
  };

  const handleReplyFile = async (file: File | null) => {
    if (!file || !displayUser) {
      setReplyAttachment(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Attachment size must be under 5MB');
      return;
    }
    const attachment = await toAttachment(file, displayUser.userId);
    setReplyAttachment(attachment);
  };

  const handleSubmitTicket = async () => {
    if (!displayUser) return;
    if (!formData.subject.trim()) {
      toast.error('Subject is required');
      return;
    }
    if (!formData.description.trim()) {
      toast.error('Detailed description is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = Database.createSupportTicket({
        user_id: displayUser.userId,
        name: formData.name.trim() || displayUser.fullName,
        email: formData.email.trim() || displayUser.email,
        category: formData.category,
        subject: formData.subject.trim(),
        message: formData.description.trim(),
        priority: formData.priority,
        attachments: submitAttachment ? [submitAttachment] : []
      });
      setFormData((prev) => ({ ...prev, subject: '', description: '' }));
      setSubmitAttachment(null);
      setSelectedTicketId(created.ticket_id);
      loadTickets();
      toast.success(`Ticket submitted: ${created.ticket_id}`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!displayUser || !selectedTicket) return;
    if (!replyMessage.trim() && !replyAttachment) {
      toast.error('Add a reply message or attachment');
      return;
    }
    setIsReplying(true);
    try {
      const updated = Database.addSupportTicketMessage({
        ticket_id: selectedTicket.ticket_id,
        sender_type: 'user',
        sender_user_id: displayUser.userId,
        sender_name: displayUser.fullName,
        message: replyMessage.trim(),
        attachments: replyAttachment ? [replyAttachment] : []
      });
      if (!updated) {
        toast.error('Ticket not found');
        return;
      }
      setReplyMessage('');
      setReplyAttachment(null);
      loadTickets();
      toast.success('Reply submitted');
    } finally {
      setIsReplying(false);
    }
  };

  if (!displayUser) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between min-h-16 py-2 sm:py-0 gap-2">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <span className="text-base sm:text-xl font-bold text-white">Support Tickets</span>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadTickets}
                className="border-white/20 text-white hover:bg-white/10"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="text-white/60 hover:text-red-400"
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Submit Support Ticket</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-white/80">User ID</Label>
                  <Input value={displayUser.userId} readOnly className="bg-[#1f2937] border-white/10 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Issue Category</Label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value as SupportTicketCategory }))}
                    className="w-full h-10 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-white/80">Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Email</Label>
                  <Input
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-white/80">Subject</Label>
                  <Input
                    value={formData.subject}
                    onChange={(e) => setFormData((prev) => ({ ...prev, subject: e.target.value }))}
                    placeholder="Short title for your issue"
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white/80">Priority</Label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData((prev) => ({ ...prev, priority: e.target.value as SupportTicketPriority }))}
                    className="w-full h-10 rounded-md bg-[#1f2937] border border-white/10 text-white px-3 text-sm"
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Detailed Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  rows={5}
                  placeholder="Describe your issue in detail so support can resolve faster."
                  className="bg-[#1f2937] border-white/10 text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Upload Screenshot / Payment Proof</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    void handleSubmitFile(file);
                  }}
                  className="bg-[#1f2937] border-white/10 text-white file:text-white"
                />
                {submitAttachment && (
                  <p className="text-xs text-emerald-400">
                    Attached: {submitAttachment.file_name}
                  </p>
                )}
              </div>

              <Button
                onClick={handleSubmitTicket}
                disabled={isSubmitting}
                className="w-full bg-[#118bdd] hover:bg-[#0f79be] text-white"
              >
                {isSubmitting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                Submit Ticket
              </Button>
            </CardContent>
          </Card>

          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Issue Guides & Notice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-lg border border-white/10 bg-[#111827]/50 p-3">
                <p className="text-white font-medium mb-2">Payment Issue Guide</p>
                <p className="text-white/70">Include Transaction ID, amount, payment method, and screenshot/payment proof.</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#111827]/50 p-3">
                <p className="text-white font-medium mb-2">Withdrawal Issue Guide</p>
                <p className="text-white/70">Include withdrawal request ID, amount, wallet address, date/time, and proof if available.</p>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-amber-300 font-medium mb-2">Important Notice</p>
                <ul className="list-disc pl-5 space-y-1 text-amber-100/90">
                  <li>All support requests must be submitted through this ticket system only.</li>
                  <li>Do not create multiple tickets for the same issue.</li>
                  <li>Support response time may take up to 24 hours.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="glass border-white/10">
          <CardHeader>
            <CardTitle className="text-white">My Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[850px]">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Ticket ID</th>
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Subject</th>
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Category</th>
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Status</th>
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Created</th>
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Updated</th>
                    <th className="text-left py-2 px-3 text-white/60 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.ticket_id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-3 text-white font-mono text-xs">{ticket.ticket_id}</td>
                      <td className="py-2 px-3 text-white/90">{ticket.subject || '-'}</td>
                      <td className="py-2 px-3 text-white/70">{CATEGORY_OPTIONS.find((x) => x.value === ticket.category)?.label || ticket.category}</td>
                      <td className="py-2 px-3">
                        <Badge className={statusClassMap[ticket.status]}>{statusLabelMap[ticket.status]}</Badge>
                      </td>
                      <td className="py-2 px-3 text-white/60 text-sm">{new Date(ticket.created_at).toLocaleString()}</td>
                      <td className="py-2 px-3 text-white/60 text-sm">{new Date(ticket.updated_at).toLocaleString()}</td>
                      <td className="py-2 px-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedTicketId(ticket.ticket_id)}
                          className="border-white/20 text-white hover:bg-white/10"
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 md:hidden">
              {tickets.map((ticket) => (
                <div key={ticket.ticket_id} className="rounded-lg border border-white/10 p-3 bg-[#111827]/55">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="font-mono text-xs text-white">{ticket.ticket_id}</p>
                    <Badge className={statusClassMap[ticket.status]}>{statusLabelMap[ticket.status]}</Badge>
                  </div>
                  <p className="text-white text-sm font-medium">{ticket.subject || '-'}</p>
                  <p className="text-white/60 text-xs mt-1">Updated: {new Date(ticket.updated_at).toLocaleString()}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedTicketId(ticket.ticket_id)}
                    className="mt-2 border-white/20 text-white hover:bg-white/10"
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    View
                  </Button>
                </div>
              ))}
            </div>

            {tickets.length === 0 && (
              <p className="text-center text-white/50 py-8">No tickets submitted yet</p>
            )}
          </CardContent>
        </Card>

        {selectedTicket && (
          <Card className="glass border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Ticket Details: {selectedTicket.ticket_id}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <p className="text-white/70"><span className="text-white">Category:</span> {CATEGORY_OPTIONS.find((x) => x.value === selectedTicket.category)?.label || selectedTicket.category}</p>
                <p className="text-white/70"><span className="text-white">Priority:</span> {selectedTicket.priority}</p>
                <p className="text-white/70"><span className="text-white">Status:</span> {statusLabelMap[selectedTicket.status]}</p>
              </div>

              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {selectedTicket.messages.map((msg) => (
                  <div key={msg.id} className="rounded-lg border border-white/10 bg-[#111827]/60 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-sm text-white">
                        {msg.sender_type === 'admin' ? 'Admin' : 'You'} - {msg.sender_name}
                      </p>
                      <p className="text-xs text-white/50">{new Date(msg.created_at).toLocaleString()}</p>
                    </div>
                    <p className="text-white/80 text-sm whitespace-pre-wrap">{msg.message || '-'}</p>
                    {msg.attachments.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {msg.attachments.map((att) => (
                          <div key={att.id}>
                            {(att.file_type?.startsWith('image/') || att.data_url?.startsWith('data:image/')) ? (
                              <a href={att.data_url} target="_blank" rel="noreferrer" className="block">
                                <img
                                  src={att.data_url}
                                  alt={att.file_name}
                                  className="max-w-[280px] max-h-[200px] rounded-lg border border-white/10 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                                />
                                <p className="text-xs text-[#7cc9ff] mt-1">{att.file_name}</p>
                              </a>
                            ) : (
                              <a href={att.data_url} target="_blank" rel="noreferrer" className="block text-xs text-[#7cc9ff] hover:underline">
                                📎 {att.file_name}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {selectedTicket.status === 'closed' ? (
                <div className="rounded-lg border border-white/10 bg-[#1f2937] p-4">
                  <p className="text-white/50 text-sm text-center">This ticket is closed. Please open a new ticket if you need further assistance.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-white/80">Reply</Label>
                  <Textarea
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                    placeholder="Add additional details for support team..."
                    className="bg-[#1f2937] border-white/10 text-white"
                  />
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <Input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        void handleReplyFile(file);
                      }}
                      className="bg-[#1f2937] border-white/10 text-white file:text-white"
                    />
                    <Button
                      onClick={handleReply}
                      disabled={isReplying}
                      className="bg-[#118bdd] hover:bg-[#0f79be] text-white"
                    >
                      {isReplying ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                      Send Reply
                    </Button>
                  </div>
                  {replyAttachment && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> {replyAttachment.file_name}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
      <MobileBottomNav />
    </div>
  );
}

