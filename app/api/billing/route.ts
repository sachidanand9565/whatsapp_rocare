import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { apiSuccess, apiError } from '@/lib/utils';
import { RowDataPacket } from 'mysql2';

const GV = 'v22.0';
const FREE_TIER = 1000;

interface ConvDataPoint {
  start: number;
  end: number;
  conversation: number;
  cost: number;
  conversation_category?: string;
}

interface MsgDataPoint {
  start: number;
  end: number;
  sent: number;
  delivered: number;
  read: number;
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAuth(req);
    const { searchParams } = new URL(req.url);

    // Support both month param and start/end date params
    const startDate = searchParams.get('start_date');
    const endDate   = searchParams.get('end_date');
    const monthParam = searchParams.get('month') || new Date().toISOString().slice(0, 7);

    let start: number;
    let end: number;
    let label: string;

    if (startDate && endDate) {
      // Use UTC midnight so the date range is correct regardless of server timezone
      start = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
      end   = Math.floor(new Date(endDate   + 'T23:59:59Z').getTime() / 1000);
      label = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
    } else {
      const [year, month] = monthParam.split('-').map(Number);
      start = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
      end   = Math.floor(Date.UTC(year, month, 0, 23, 59, 59) / 1000);
      label = monthParam;
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT waba_id, access_token, phone_number_id FROM workspaces WHERE id = ?`,
      [payload.workspaceId]
    );

    if (!rows.length || !rows[0].waba_id || !rows[0].access_token) {
      return apiError('WhatsApp not connected', 400);
    }

    const { waba_id, access_token, phone_number_id } = rows[0] as {
      waba_id: string;
      access_token: string;
      phone_number_id: string | null;
    };

    // 1. Conversation analytics (billing data — 24-72h delay)
    // Use URLSearchParams so brackets/quotes in dimensions & phone_numbers are properly encoded
    const convParams = new URLSearchParams({
      start:       String(start),
      end:         String(end),
      granularity: 'DAILY',
      dimensions:  JSON.stringify(['CONVERSATION_CATEGORY']),
      access_token,
    });
    if (phone_number_id) {
      convParams.set('phone_numbers', JSON.stringify([phone_number_id]));
    }
    const convUrl = `https://graph.facebook.com/${GV}/${waba_id}/conversation_analytics?${convParams}`;

    // 2. Message analytics (real-time sent/delivered/read)
    // Uses field expansion syntax — required in v22.0+
    const msgUrl = phone_number_id
      ? `https://graph.facebook.com/${GV}/${phone_number_id}?fields=analytics.start(${start}).end(${end}).granularity(DAY)&access_token=${access_token}`
      : null;

    const [convRes, msgRes] = await Promise.all([
      fetch(convUrl).then(r => r.json()).catch((e) => { console.error('[billing] conv fetch error:', e); return { data: [] }; }),
      msgUrl ? fetch(msgUrl).then(r => r.json()).catch((e) => { console.error('[billing] msg fetch error:', e); return null; }) : Promise.resolve(null),
    ]);

    console.log('[billing] conv response:', JSON.stringify(convRes).slice(0, 400));
    console.log('[billing] msg  response:', JSON.stringify(msgRes).slice(0, 400));

    // Surface Meta API errors to the client so they're visible
    if (convRes?.error) {
      console.error('[billing] Meta conv error:', convRes.error);
    }
    if (msgRes?.error) {
      console.error('[billing] Meta msg error:', msgRes.error);
    }

    // ── Parse conversation analytics ──────────────────────────────────────
    const byDay: Record<string, {
      date: string;
      marketing: number; utility: number; authentication: number; service: number;
      cost: number; sent: number; delivered: number; read: number;
    }> = {};

    const byCategory: Record<string, { conversations: number; cost: number }> = {
      MARKETING:      { conversations: 0, cost: 0 },
      UTILITY:        { conversations: 0, cost: 0 },
      AUTHENTICATION: { conversations: 0, cost: 0 },
      SERVICE:        { conversations: 0, cost: 0 },
    };

    let totalConversations = 0;
    let totalCost = 0;

    if (!convRes.error && Array.isArray(convRes.data)) {
      const points: ConvDataPoint[] = convRes.data.flatMap(
        (d: { data_points?: ConvDataPoint[]; conversation_category?: string }) =>
          (d.data_points || []).map((dp: ConvDataPoint) => ({
            ...dp,
            conversation_category: dp.conversation_category || d.conversation_category,
          }))
      );

      for (const dp of points) {
        const date = new Date(dp.start * 1000).toISOString().slice(0, 10);
        const cat  = (dp.conversation_category || 'SERVICE').toUpperCase();
        const cnt  = dp.conversation || 0;
        const cost = dp.cost || 0;

        if (!byDay[date]) byDay[date] = { date, marketing: 0, utility: 0, authentication: 0, service: 0, cost: 0, sent: 0, delivered: 0, read: 0 };

        if (cat === 'MARKETING')      byDay[date].marketing      += cnt;
        else if (cat === 'UTILITY')   byDay[date].utility        += cnt;
        else if (cat === 'AUTHENTICATION') byDay[date].authentication += cnt;
        else                          byDay[date].service        += cnt;
        byDay[date].cost += cost;

        if (byCategory[cat]) { byCategory[cat].conversations += cnt; byCategory[cat].cost += cost; }
        totalConversations += cnt;
        totalCost          += cost;
      }
    }

    // ── Parse message analytics ───────────────────────────────────────────
    let totalSent = 0, totalDelivered = 0, totalRead = 0;

    const msgPoints: MsgDataPoint[] = msgRes?.analytics?.data_points || [];
    for (const mp of msgPoints) {
      const date = new Date(mp.start * 1000).toISOString().slice(0, 10);
      if (!byDay[date]) byDay[date] = { date, marketing: 0, utility: 0, authentication: 0, service: 0, cost: 0, sent: 0, delivered: 0, read: 0 };
      byDay[date].sent      += mp.sent      || 0;
      byDay[date].delivered += mp.delivered || 0;
      byDay[date].read      += mp.read      || 0;
      totalSent      += mp.sent      || 0;
      totalDelivered += mp.delivered || 0;
      totalRead      += mp.read      || 0;
    }

    for (const cat of Object.values(byCategory)) cat.cost = Math.round(cat.cost * 10000) / 10000;
    for (const day of Object.values(byDay))      day.cost = Math.round(day.cost * 10000) / 10000;

    return apiSuccess({
      label,
      has_conv_data: totalConversations > 0,
      has_msg_data:  totalSent > 0,
      summary: {
        total_conversations: totalConversations,
        total_cost:          Math.round(totalCost * 10000) / 10000,
        free_tier_used:      Math.min(totalConversations, FREE_TIER),
        free_tier_remaining: Math.max(0, FREE_TIER - totalConversations),
        paid_conversations:  Math.max(0, totalConversations - FREE_TIER),
        total_sent:          totalSent,
        total_delivered:     totalDelivered,
        total_read:          totalRead,
        delivery_rate:       totalSent > 0 ? Math.round((totalDelivered / totalSent) * 1000) / 10 : 0,
      },
      by_category: byCategory,
      daily: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      _debug: { waba_id, phone_number_id, conv_raw: convRes, msg_raw: msgRes },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return apiError('Unauthorized', 401);
    console.error('[billing]', err);
    return apiError('Server error', 500);
  }
}
