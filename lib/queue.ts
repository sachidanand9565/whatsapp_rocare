/**
 * lib/queue.ts
 * BullMQ queues for offloading flow-engine / chatbot processing off the
 * webhook request path (both make outbound Meta API calls, which risk
 * Meta's webhook timeout/retry if done synchronously).
 * Redis runs locally on the same EC2 instance as the app (see scripts/install.sh).
 */
import { Queue, ConnectionOptions } from 'bullmq';

declare global {
  // eslint-disable-next-line no-var
  var _flowQueue: Queue<FlowJobData> | undefined;
  // eslint-disable-next-line no-var
  var _chatbotQueue: Queue<ChatbotJobData> | undefined;
}

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // required by BullMQ's blocking commands
};

export interface FlowJobData {
  workspaceId:    number;
  contactId:      number;
  phone:          string;
  userMessage:    string;
  accessToken:    string;
  phoneNumberId:  string;
  buttonPayload?: string;
  contextWamid?:  string;
  incomingWamid?: string;
  msgType:        'text' | 'button' | 'interactive';
}

export interface ChatbotJobData {
  workspaceId:   number;
  contactId:     number;
  text:          string;
  phoneNumberId: string;
}

const JOB_OPTS = {
  removeOnComplete: 1000,
  removeOnFail:     5000,
  attempts:         3,
  backoff:          { type: 'exponential' as const, delay: 2000 },
};

function getFlowQueue(): Queue<FlowJobData> {
  if (!global._flowQueue) {
    global._flowQueue = new Queue<FlowJobData>('flow-queue', { connection: redisConnection });
  }
  return global._flowQueue;
}

function getChatbotQueue(): Queue<ChatbotJobData> {
  if (!global._chatbotQueue) {
    global._chatbotQueue = new Queue<ChatbotJobData>('chatbot-queue', { connection: redisConnection });
  }
  return global._chatbotQueue;
}

export async function enqueueFlowJob(data: FlowJobData): Promise<void> {
  await getFlowQueue().add('process', data, JOB_OPTS);
}

export async function enqueueChatbotJob(data: ChatbotJobData): Promise<void> {
  await getChatbotQueue().add('process', data, JOB_OPTS);
}
