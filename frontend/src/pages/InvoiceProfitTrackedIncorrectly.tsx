import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore } from '@/store';
import Database from '@/db';
import type { MarketplaceInvoice, MarketplaceRetailer, SupportTicketAttachment } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import MobileBottomNav from '@/components/MobileBottomNav';
import { uploadOptimizedFileToBackend } from '@/utils/helpers';

async function toAttachment(file: File, uploadedBy: string): Promise<SupportTicketAttachment> {
  const uploaded = await uploadOptimizedFileToBackend(file, {
    scope: 'invoice-queries',
    maxDimension: 1800,
    targetBytes: 650 * 1024,
    quality: 0.86
  });
  return {
    id: `support_att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    file_name: uploaded.fileName,
    file_type: uploaded.mimeType || file.type || 'application/octet-stream',
    file_size: uploaded.sizeBytes || file.size,
    data_url: '',
    file_url: uploaded.fileUrl,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString()
  };
}

export default function InvoiceProfitTrackedIncorrectly() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, impersonatedUser, isAuthenticated } = useAuthStore();
  const displayUser = impersonatedUser || user;
  const routeState = ((location.state as { invoice?: MarketplaceInvoice; queryType?: string } | null) ?? null);
  const queryInvoice = routeState?.invoice ?? null;
  const queryType = routeState?.queryType === 'different_query' ? 'different_query' : 'profit_tracked_incorrectly';

  const [helpText, setHelpText] = useState('');
  const [attachment, setAttachment] = useState<SupportTicketAttachment | null>(null);
  const [attachmentName, setAttachmentName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!queryInvoice) {
      navigate('/invoice-query', { replace: true });
    }
  }, [isAuthenticated, navigate, queryInvoice]);

  const retailer = useMemo<MarketplaceRetailer | null>(() => {
    if (!queryInvoice?.retailerId) return null;
    return Database.getMarketplaceRetailers().find((item) => item.id === queryInvoice.retailerId) || null;
  }, [queryInvoice]);

  const transactionDate = useMemo(() => {
    if (!queryInvoice?.createdAt) return '-';
    return new Date(queryInvoice.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }, [queryInvoice]);

  const rpAmountLabel = useMemo(() => {
    if (!queryInvoice) return '-';
    return queryInvoice.rewardPoints > 0 ? `${queryInvoice.rewardPoints} RP` : 'Pending Review';
  }, [queryInvoice]);

  const pageTitle = queryType === 'different_query'
    ? 'I have a different query.'
    : 'My Profit has tracked incorrectly';

  const handleAttachmentChange = async (file: File | null) => {
    if (!file || !displayUser) {
      setAttachment(null);
      setAttachmentName('');
      return;
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Allowed file types: .png, .jpeg, .jpg, .pdf');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Allowed file size is 2MB');
      return;
    }

    try {
      const nextAttachment = await toAttachment(file, displayUser.userId);
      setAttachment(nextAttachment);
      setAttachmentName(file.name);
    } catch {
      toast.error('Failed to read attachment');
    }
  };

  const handleSubmitQuery = async () => {
    if (!displayUser || !queryInvoice) return;
    if (!helpText.trim()) {
      toast.error('Please explain how we can help you');
      return;
    }
    if (!attachment) {
      toast.error('Please upload screenshot from retailer order history page');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await Database.runWithLocalStateTransaction(() => Database.createSupportTicket({
        user_id: displayUser.userId,
        name: displayUser.fullName,
        email: displayUser.email,
        category: 'affiliate_shopping',
        priority: 'medium',
        subject: `Invoice Query: ${queryType === 'different_query' ? 'Different query' : 'Profit tracked incorrectly'} - ${queryInvoice.retailerName}${queryInvoice.orderId ? ` (${queryInvoice.orderId})` : ''}`,
        message: [
          `Invoice Query Type: ${queryType === 'different_query' ? 'I have a different query.' : 'My Profit has tracked incorrectly'}`,
          `Retailer: ${queryInvoice.retailerName}`,
          `Order ID: ${queryInvoice.orderId || '-'}`,
          `RP Amount: ${rpAmountLabel}`,
          `Order Amount: ${queryInvoice.amount.toFixed(2)}`,
          `Transaction Date: ${transactionDate}`,
          '',
          'User Message:',
          helpText.trim()
        ].join('\n'),
        attachments: [attachment]
      }), {
        syncOnCommit: true,
        syncOptions: {
          full: false,
          force: true,
          timeoutMs: 60000,
          maxAttempts: 3,
          retryDelayMs: 1500
        }
      });

      toast.success(`Query submitted: ${created.ticket_id}`);
      navigate(`/support?ticket=${created.ticket_id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit query');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!displayUser || !queryInvoice) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17] pb-24 md:pb-0">
      <header className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="min-h-16 py-2 sm:py-0 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/invoice-query', { state: { invoice: queryInvoice } })}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#118bdd] to-[#6366f1] flex items-center justify-center">
                <HelpCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold">{pageTitle}</p>
                <p className="text-xs text-white/50">{queryInvoice.retailerName}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div
          className="relative overflow-hidden rounded-[28px] p-6 sm:p-8"
          style={{ background: 'linear-gradient(180deg, #111827 0%, #0d1117 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(17,139,221,0.18),transparent_30%),radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_28%)]" />
          <div className="relative space-y-6">
            <div>
              <p className="text-sm text-white/70 leading-7">
                Please tell us why you feel the profit given to you was incorrect.
              </p>
            </div>

            <div className="border-b border-dashed border-white/10" />

            <div className="flex items-center justify-center">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                {retailer?.logoUrl ? (
                  <img src={retailer.logoUrl} alt={queryInvoice.retailerName} className="h-10 w-auto object-contain" />
                ) : (
                  <div className="flex h-10 min-w-24 items-center justify-center rounded-xl bg-white/5 text-sm font-bold text-white">
                    {queryInvoice.retailerName}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div className="border-b border-dashed border-white/10 pb-4">
                <p className="text-sm text-white/45">Order ID</p>
                <p className="mt-2 text-2xl font-semibold text-white">{queryInvoice.orderId || '-'}</p>
              </div>
              <div className="border-b border-dashed border-white/10 pb-4">
                <p className="text-sm text-white/45">RP Amount</p>
                <p className="mt-2 text-2xl font-semibold text-white">{rpAmountLabel}</p>
              </div>
              <div className="border-b border-dashed border-white/10 pb-4">
                <p className="text-sm text-white/45">Order Amount</p>
                <p className="mt-2 text-2xl font-semibold text-white">{queryInvoice.amount.toFixed(2)}</p>
              </div>
              <div className="border-b border-dashed border-white/10 pb-4">
                <p className="text-sm text-white/45">Transaction Date</p>
                <p className="mt-2 text-2xl font-semibold text-white">{transactionDate}</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-white/55">How can we help you? Please mention below.</p>
              <Textarea
                rows={6}
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder="Write your issue in detail..."
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/30"
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm text-white/70">
                Upload screenshot from retailer order history page. <span className="text-rose-300">(Mandatory)</span>
              </p>
              <label className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.04] px-4 transition-colors hover:bg-white/[0.06]">
                <Upload className="h-4 w-4 text-white/40" />
                <span className={`truncate text-sm ${attachmentName ? 'text-white' : 'text-white/35'}`}>
                  {attachmentName || 'Choose file'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,application/pdf"
                  className="hidden"
                  onChange={(e) => void handleAttachmentChange(e.target.files?.[0] || null)}
                />
              </label>
              <p className="text-xs text-white/35">Allowed file types: .png, .jpeg, .jpg, .pdf • Allowed file size: 2MB</p>
            </div>

            <Button
              onClick={handleSubmitQuery}
              disabled={isSubmitting}
              className="w-full h-12 bg-gradient-to-r from-[#118bdd] to-[#6366f1] text-white hover:opacity-95"
            >
              {isSubmitting ? 'Submitting Query...' : 'Submit Query'}
            </Button>
          </div>
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
