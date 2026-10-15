/**
 * lib/alerts.ts — email the workspace when sending breaks at the account level.
 *
 * A payment failure or a banned number fails every message silently: the panel
 * shows failed rows, but nobody is watching them. These alerts go to the
 * owner's registration email the first time such a failure appears, then stay
 * quiet for COOLDOWN_MINUTES so a 5,000-contact campaign sends one mail, not
 * 5,000.
 */
import { query, execute, insert } from '@/lib/db';
import { sendMail, mailConfigured } from '@/lib/mailer';
import { RowDataPacket } from 'mysql2';

export type AlertType = 'payment' | 'banned' | 'token' | 'other';

const COOLDOWN_MINUTES = 180;   // 3 hours between repeats of the same alert
const RETRY_MINUTES    = 5;     // after a send error, allow another attempt sooner

/**
 * In-process claim, taken BEFORE any await. A campaign fires 80 sends in
 * parallel; without this they would all read an empty alert_log and all send
 * their own email. The alert_log check below still covers restarts and the
 * worker process.
 */
const claimed = new Map<string, number>();   // "workspaceId:type" → claim expiry (ms)

interface Rule {
  type:   AlertType;
  title:  string;
  what:   string;
  fix:    string;
}

/**
 * Meta error codes worth waking someone up for. Per-recipient problems
 * (invalid number, user has no WhatsApp) are deliberately absent — they are
 * normal in any campaign and would make these emails noise.
 */
const RULES: Record<number, Rule> = {
  131042: {
    type:  'payment',
    title: 'WhatsApp sending stopped — payment issue',
    what:  'Meta is rejecting your messages because of a billing problem on the WhatsApp Business account.',
    fix:   'Open Meta Business Manager → Billing & payments, and fix or re-add the payment method. Sending resumes on its own once Meta accepts it.',
  },
  131031: {
    type:  'banned',
    title: 'WhatsApp sending stopped — account restricted',
    what:  'Meta has locked or restricted this WhatsApp Business account, so no messages are going out.',
    fix:   'Check Meta Business Manager → Account Quality for the violation and the appeal option.',
  },
  368: {
    type:  'banned',
    title: 'WhatsApp sending stopped — temporarily blocked',
    what:  'The number is temporarily blocked by Meta for policy violations.',
    fix:   'Check Meta Business Manager → Account Quality. Sending resumes when the block expires or the appeal succeeds.',
  },
  190: {
    type:  'token',
    title: 'WhatsApp sending stopped — access token expired',
    what:  'The access token saved for this number is no longer valid, so Meta refuses every request.',
    fix:   'Reconnect the number in Settings → Auth & WhatsApp to store a fresh token.',
  },
  102: {
    type:  'token',
    title: 'WhatsApp sending stopped — session expired',
    what:  'Meta rejected the saved credentials for this number.',
    fix:   'Reconnect the number in Settings → Auth & WhatsApp.',
  },
};

/** Pulls "(#131042)" or a bare code out of whatever text we stored. */
export function extractErrorCode(text: string): number | null {
  const m = String(text || '').match(/#(\d{2,6})/);
  return m ? Number(m[1]) : null;
}

function alertEmail(rule: Rule, workspaceName: string, detail: string) {
  const text =
    `${rule.title}\n\n` +
    `Account: ${workspaceName}\n\n` +
    `${rule.what}\n\n` +
    `What to do: ${rule.fix}\n\n` +
    `Meta's exact words: ${detail}\n`;

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px">
      <h2 style="margin:0 0 6px;font-size:17px;color:#b91c1c">${rule.title}</h2>
      <p style="margin:0;color:#7f1d1d;font-size:14px">Account: <strong>${workspaceName}</strong></p>
    </div>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.6">${rule.what}</p>
    <p style="margin:14px 0 0;font-size:14px;line-height:1.6"><strong>What to do:</strong> ${rule.fix}</p>
    <p style="margin:18px 0 0;font-size:12px;color:#666">Meta's exact words: ${detail}</p>
    <p style="margin:18px 0 0;font-size:12px;color:#888">
      You are getting this because message sending failed on your account. Manage these alerts in Settings → Alerts.
    </p>
  </div>`;

  return { subject: rule.title, text, html };
}

/** Owner's registration email first, then any extras the workspace added. */
async function recipientsFor(workspaceId: number): Promise<{ emails: string[]; enabled: boolean; workspaceName: string }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT w.name AS workspace_name, u.email AS owner_email,
            s.enabled, s.extra_emails
     FROM workspaces w
     LEFT JOIN users u          ON u.id = w.owner_id
     LEFT JOIN alert_settings s ON s.workspace_id = w.id
     WHERE w.id = ? LIMIT 1`,
    [workspaceId]
  );
  const row = rows[0];
  if (!row) return { emails: [], enabled: false, workspaceName: '' };

  // No settings row yet → alerts are on by default
  const enabled = row.enabled === null || row.enabled === undefined ? true : Number(row.enabled) === 1;
  const extras  = String(row.extra_emails || '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));

  const emails = [...new Set([String(row.owner_email || ''), ...extras].filter((e) => e.includes('@')))];
  return { emails, enabled, workspaceName: String(row.workspace_name || 'your account') };
}

/**
 * Called from the send paths. Never throws and never blocks the caller —
 * a broken mailbox must not stop a campaign.
 */
export async function reportSendFailure(
  workspaceId: number,
  errorCode: number | null,
  detail: string,
): Promise<void> {
  if (!workspaceId || !errorCode) return;
  const rule = RULES[errorCode];
  if (!rule) return;                         // not an account-level problem
  if (!mailConfigured()) return;

  // Claim this alert synchronously — whoever gets here first owns the email
  const key = `${workspaceId}:${rule.type}`;
  const now = Date.now();
  if ((claimed.get(key) || 0) > now) return;
  claimed.set(key, now + COOLDOWN_MINUTES * 60_000);

  try {
    const { emails, enabled, workspaceName } = await recipientsFor(workspaceId);
    if (!enabled || emails.length === 0) return;

    // Throttle: one mail per workspace per alert type per cooldown window
    const recent = await query<RowDataPacket[]>(
      `SELECT id FROM alert_log
       WHERE workspace_id = ? AND alert_type = ?
         AND sent_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
       LIMIT 1`,
      [workspaceId, rule.type, COOLDOWN_MINUTES]
    );
    if (recent.length > 0) return;

    const trimmed = String(detail || '').slice(0, 500);
    const mail    = alertEmail(rule, workspaceName, trimmed || `Meta error ${errorCode}`);
    await sendMail({ to: emails.join(','), ...mail });

    await insert(
      `INSERT INTO alert_log (workspace_id, alert_type, error_code, detail, recipients)
       VALUES (?, ?, ?, ?, ?)`,
      [workspaceId, rule.type, errorCode, trimmed, emails.join(',').slice(0, 500)]
    );
    console.log(`[alerts] ${rule.type} alert sent for workspace ${workspaceId} to ${emails.join(',')}`);
  } catch (err) {
    // Alerting is best-effort — a missing table or a dead SMTP host must not
    // break sending. Shorten the claim so the next failure tries again instead
    // of staying silent for the full cooldown.
    claimed.set(key, Date.now() + RETRY_MINUTES * 60_000);
    console.error('[alerts] could not send alert:', err instanceof Error ? err.message : err);
  }
}

/** Settings page: send one real alert email so the recipient list is proven. */
export async function sendTestAlert(workspaceId: number): Promise<string[]> {
  if (!mailConfigured()) throw new Error('Email service is not configured — contact support');
  const { emails, workspaceName } = await recipientsFor(workspaceId);
  if (emails.length === 0) throw new Error('No recipient email found for this workspace');

  const rule = RULES[131042];
  const mail = alertEmail(rule, workspaceName, 'This is a test — nothing is wrong with your account.');
  await sendMail({ to: emails.join(','), ...mail, subject: `[Test] ${mail.subject}` });
  return emails;
}

export async function saveAlertSettings(
  workspaceId: number,
  enabled: boolean,
  extraEmails: string[],
): Promise<void> {
  await execute(
    `INSERT INTO alert_settings (workspace_id, enabled, extra_emails)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), extra_emails = VALUES(extra_emails)`,
    [workspaceId, enabled ? 1 : 0, extraEmails.join(',').slice(0, 500) || null]
  );
}
