import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import App from './App.tsx'
import Database from './db'
import { resolveBackendBaseUrl } from '@/utils/backendBaseUrl'

// Emergency reset mode: visit localhost:5173?reset=true to bypass heavy loading
const isEmergencyReset = new URLSearchParams(window.location.search).get('reset') === 'true';
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}
const root = createRoot(rootElement);

async function bootstrap() {
  if (isEmergencyReset) {
    // Render a minimal emergency reset page — no heavy data loading at all
    root.render(
      <StrictMode>
        <div style={{
          background: '#1a1a2e', color: '#eee', minHeight: '100vh',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', fontFamily: 'system-ui, sans-serif', gap: '20px'
        }}>
          <h1 style={{ color: '#e94560' }}>⚠️ Emergency Data Cleanup</h1>
          <p style={{ maxWidth: 550, textAlign: 'center', lineHeight: 1.6 }}>
            Your browser is running out of memory due to too many accumulated transactions.
            Click below to clean the <strong>server database</strong> directly.
          </p>
          <p style={{ maxWidth: 550, textAlign: 'center', lineHeight: 1.6, color: '#4ecca3' }}>
            ✅ <strong>All users will be KEPT</strong><br />
            ✅ Matrix structure will be KEPT<br />
            ✅ Pins will be KEPT<br />
            🗑️ Transactions & help trackers will be cleared<br />
            🗑️ Wallet balances reset to $0 (rebuild recalculates)
          </p>
          <div id="status" style={{
            padding: '12px 20px', background: '#16213e', borderRadius: '8px',
            maxWidth: 550, textAlign: 'center', minHeight: '24px'
          }}>
            Ready to clean up.
          </div>
          <button
            id="cleanupBtn"
            onClick={async () => {
              const statusEl = document.getElementById('status');
              const btnEl = document.getElementById('cleanupBtn') as HTMLButtonElement;
              if (statusEl) statusEl.textContent = '⏳ Cleaning up server database...';
              if (btnEl) btnEl.disabled = true;

              try {
                // Call the backend cleanup endpoint directly
                const configuredBackend = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BACKEND_URL;
                const backendBase = resolveBackendBaseUrl(configuredBackend);
                const response = await fetch(`${backendBase}/api/cleanup-for-rebuild`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' }
                });
                const result = await response.json();

                if (result.ok) {
                  // Also clear localStorage so it doesn't re-upload old data
                  const heavyKeys = [
                    'mlm_transactions', 'mlm_help_trackers',
                    'mlm_pending_matrix_contributions', 'mlm_safety_pool'
                  ];
                  for (const key of heavyKeys) {
                    localStorage.removeItem(key);
                  }
                  // Reset wallet balances in localStorage too
                  try {
                    const wallets = JSON.parse(localStorage.getItem('mlm_wallets') || '[]');
                    const resetWallets = wallets.map((w: any) => ({
                      ...w, incomeWallet: 0, royaltyWallet: 0, matrixWallet: 0, totalReceived: 0,
                      totalGiven: 0, giveHelpLocked: 0, lockedIncomeWallet: 0,
                    }));
                    localStorage.setItem('mlm_wallets', JSON.stringify(resetWallets));
                  } catch { /* ignore */ }

                  if (statusEl) {
                    statusEl.innerHTML = `✅ ${result.message}<br/><br/><strong>Redirecting to admin page in 3 seconds...</strong>`;
                    statusEl.style.color = '#4ecca3';
                  }
                  setTimeout(() => { window.location.href = '/admin'; }, 3000);
                } else {
                  if (statusEl) {
                    statusEl.textContent = '❌ Error: ' + (result.error || 'Unknown error');
                    statusEl.style.color = '#e94560';
                  }
                  if (btnEl) btnEl.disabled = false;
                }
              } catch (e) {
                if (statusEl) {
                  statusEl.textContent = '❌ Could not reach the backend. Is it running?';
                  statusEl.style.color = '#e94560';
                }
                if (btnEl) btnEl.disabled = false;
              }
            }}
            style={{
              padding: '16px 40px', fontSize: '18px', fontWeight: 'bold',
              background: '#4ecca3', color: '#1a1a2e', border: 'none',
              borderRadius: '12px', cursor: 'pointer'
            }}
          >
            🧹 Clean Database (Keep All Users)
          </button>
          <a href="/" style={{ color: '#999', marginTop: '10px' }}>← Go back without cleaning</a>
        </div>
      </StrictMode>,
    );
    return;
  }

  const strictSync = import.meta.env.PROD;

  // Render app immediately; hydration now runs in background so login is not blocked on a full snapshot fetch.
  Database.startBackgroundSyncLoop();

  root.render(
    <StrictMode>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        storageKey="refernex-theme"
      >
        <App />
      </ThemeProvider>
    </StrictMode>,
  )

  void Database.hydrateFromServerBatches(
    strictSync ? Database.getStartupRemoteSyncBatches() : [Database.getStartupRemoteSyncKeys()],
    strictSync
      ? { strict: true, maxAttempts: 2, timeoutMs: 45000, retryDelayMs: 1200, continueOnError: true, requireAnySuccess: true }
      : { strict: false, continueOnError: true }
  ).then(() => {
    // Only seed demo admin in dev mode AND only after hydration so we don't
    // create duplicates when a real backend already has the admin user.
    if (!strictSync) {
      Database.initializeDemoData();
    }
  }).catch((e) => {
    console.warn('Hydration failed:', e);
    // Still seed demo data in dev even if hydration failed (offline dev).
    if (!strictSync) {
      Database.initializeDemoData();
    }
  });
}

void bootstrap()
