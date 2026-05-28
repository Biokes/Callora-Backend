import crypto from 'crypto';
import { WebhookConfig, WebhookPayload, DeadLetterEntry, WebhookDeliveryStatus } from './webhook.types.js';
import { WebhookStore } from './webhook.store.js';
import { logger } from '../logger.js';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000; // Cap maximum backoff at 30 seconds

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Calculate exponential backoff with jitter to avoid thundering herd
function calculateBackoff(attempt: number): number {
    const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
    // Add jitter: random value between 0-25% of the exponential delay
    const jitter = Math.random() * 0.25 * exponentialDelay;
    const delayWithJitter = exponentialDelay + jitter;
    // Cap at maximum delay
    return Math.min(delayWithJitter, MAX_DELAY_MS);
}

function signPayload(secret: string, body: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function generateDeadLetterId(): string {
    return `dl_${crypto.randomUUID()}`;
}

export async function dispatchWebhook(
    config: WebhookConfig,
    payload: WebhookPayload
): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Callora-Webhook/1.0',
        'X-Callora-Event': payload.event,
        'X-Callora-Timestamp': payload.timestamp,
    };

    if (config.secret) {
        headers['X-Callora-Signature'] = `sha256=${signPayload(config.secret, body)}`;
    }

    let lastError: unknown;
    let lastAttemptAt = new Date();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(config.url, {
                method: 'POST',
                body,
                headers,
                signal: AbortSignal.timeout(10_000), // 10s timeout per attempt
            });

            if (response.ok) {
                console.log(
                    `[webhook] ✓ Delivered ${payload.event} to ${config.url} (attempt ${attempt + 1})`
                );
                return; // success — stop retrying
            }

            console.warn(
                `[webhook] Non-2xx response (${response.status}) for ${config.url}, attempt ${attempt + 1}`
            );
        } catch (err) {
            lastError = err;
            console.warn(
                `[webhook] Error delivering to ${config.url}, attempt ${attempt + 1}:`,
                (err as Error).message
            );
        }

        if (attempt < MAX_RETRIES - 1) {
            const delay = calculateBackoff(attempt);
            console.log(`[webhook] Retrying in ${delay.toFixed(0)}ms...`);
            await sleep(delay);
            lastAttemptAt = new Date();
        }
    }

    // All retries exhausted - move to dead-letter queue
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    
    const deadLetterEntry: DeadLetterEntry = {
        id: generateDeadLetterId(),
        webhookConfigId: config.developerId,
        url: config.url,
        event: payload.event,
        payload,
        status: 'dead_letter' as WebhookDeliveryStatus,
        attempts: MAX_RETRIES,
        lastError: errorMessage,
        lastAttemptAt,
        deadLetterAt: new Date(),
    };

    WebhookStore.addDeadLetterEntry(deadLetterEntry);

    logger.error(
        `[webhook] ✗ Failed to deliver ${payload.event} to ${config.url} after ${MAX_RETRIES} attempts. Moved to dead-letter queue.`,
        lastError
    );
}

export async function dispatchToAll(
    configs: WebhookConfig[],
    payload: WebhookPayload
): Promise<void> {
    await Promise.allSettled(configs.map((cfg) => dispatchWebhook(cfg, payload)));
}
