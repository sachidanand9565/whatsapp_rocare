/**
 * workers/chatbot-worker.ts
 * Consumes chatbot-queue jobs — only reached when the Flow Worker found no
 * active/matching flow for the message. Each job is a stateless rule match
 * against a single message (no shared session state like the flow worker
 * has), so it's safe to run with higher concurrency.
 * Run as its own long-lived process via PM2 (see scripts/start.sh):
 *   npx tsx workers/chatbot-worker.ts
 */
import { Worker, Job } from 'bullmq';
import { redisConnection, ChatbotJobData } from '@/lib/queue';
import { processChatbot } from '@/lib/chatbot';

const worker = new Worker<ChatbotJobData>(
  'chatbot-queue',
  async (job: Job<ChatbotJobData>) => {
    const { workspaceId, contactId, text, phoneNumberId } = job.data;
    await processChatbot(workspaceId, contactId, text, phoneNumberId);
  },
  { connection: redisConnection, concurrency: 5 }
);

worker.on('failed', (job, err) => {
  console.error(`[chatbot-worker] job ${job?.id} failed:`, err.message);
});
worker.on('error', (err) => {
  console.error('[chatbot-worker] worker error:', err.message);
});

console.log('[chatbot-worker] started (concurrency=5)');
