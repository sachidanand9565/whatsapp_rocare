/**
 * Build Meta `button` send-components from a template's stored buttons.
 *
 * Meta's `index` is the button's position in the approved template, where
 * CTA buttons (URL / PHONE_NUMBER) come before QUICK_REPLY buttons.
 *   - urlParams[i]      → value for the i-th dynamic URL button ({{1}} suffix)
 *   - quickPayloads[i]  → payload for the i-th QUICK_REPLY button
 */
interface StoredButton { type?: string; url?: string }

export function buildButtonComponents(
  storedButtons: unknown,
  urlParams?: unknown,
  quickPayloads?: unknown,
): object[] {
  let btns: StoredButton[] = [];
  try {
    const parsed = typeof storedButtons === 'string' ? JSON.parse(storedButtons || '[]') : storedButtons;
    if (Array.isArray(parsed)) btns = parsed;
  } catch { btns = []; }

  const ordered = [
    ...btns.filter((b) => b.type !== 'QUICK_REPLY'),
    ...btns.filter((b) => b.type === 'QUICK_REPLY'),
  ];

  const urls     = Array.isArray(urlParams)     ? urlParams.map(String)     : typeof urlParams === 'string' ? [urlParams] : [];
  const payloads = Array.isArray(quickPayloads) ? quickPayloads.map(String) : [];
  const components: object[] = [];

  // Dynamic URL buttons — Meta rejects the send if their {{1}} value is missing
  let urlIdx = 0;
  ordered.forEach((b, index) => {
    if (b.type !== 'URL' || !/\{\{\d+\}\}/.test(b.url || '')) return;
    const value = urls[urlIdx++];
    if (value === undefined || value === '') return;
    components.push({
      type: 'button', sub_type: 'url', index: String(index),
      parameters: [{ type: 'text', text: value }],
    });
  });

  // Quick reply payloads — fall back to plain position when template buttons are unknown
  const qrIndexes = ordered.map((b, i) => (b.type === 'QUICK_REPLY' ? i : -1)).filter((i) => i >= 0);
  payloads.forEach((pl, i) => {
    const index = qrIndexes.length > 0 ? qrIndexes[i] : i;
    if (index === undefined) return;
    components.push({
      type: 'button', sub_type: 'quick_reply', index: String(index),
      parameters: [{ type: 'payload', payload: pl }],
    });
  });

  return components;
}
