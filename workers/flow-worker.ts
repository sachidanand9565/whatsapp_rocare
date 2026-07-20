/**
 * workers/flow-worker.ts
 * Consumes flow-queue jobs enqueued by app/api/webhook/route.ts.
 * Run as its own long-lived process via PM2 (see scripts/start.sh):
 *   npx tsx workers/flow-worker.ts
 *
 * concurrency = 1 is intentional, not a bottleneck left unfixed: flow_sessions
 * state must never be read/written by two jobs at once, or a race there could
 * corrupt an in-progress flow session (e.g. two quick messages from the same
 * contact both reading the same "current step" before either writes the next
 * one). A single worker guarantees jobs run strictly one at a time, which is
 * actually stricter than today's synchronous webhook handler (two overlapping
 * webhook HTTP requests for the same contact could already interleave there).
 */
import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { redisConnection, FlowJobData, enqueueChatbotJob } from '@/lib/queue';
import { tryResumeFlow, tryStartFlow } from '@/lib/flow-engine';

const worker = new Worker<FlowJobData>(
  'flow-queue',
  async (job: Job<FlowJobData>) => {
    const {
      workspaceId, contactId, phone, userMessage, accessToken, phoneNumberId,
      buttonPayload, contextWamid, incomingWamid, msgType,
    } = job.data;

    if (msgType === 'interactive') {
      // Matches original behavior: interactive replies only resume an active
      // session, never start a new flow or fall back to the chatbot.
      await tryResumeFlow(
        workspaceId, contactId, phone, userMessage, accessToken, phoneNumberId,
        buttonPayload, contextWamid, incomingWamid
      ).catch(() => {});
      return;
    }

    const resumed = await tryResumeFlow(
      workspaceId, contactId, phone, userMessage, accessToken, phoneNumberId,
      buttonPayload, contextWamid, incomingWamid
    ).catch(() => false);
    if (resumed) return;

    const started = await tryStartFlow(
      workspaceId, contactId, phone, userMessage, accessToken, phoneNumberId, incomingWamid
    ).catch(() => false);
    if (started) return;

    await enqueueChatbotJob({ workspaceId, contactId, text: userMessage, phoneNumberId });
  },
  { connection: redisConnection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  console.error(`[flow-worker] job ${job?.id} failed:`, err.message);
});
worker.on('error', (err) => {
  console.error('[flow-worker] worker error:', err.message);
});

console.log('[flow-worker] started (concurrency=1)');
