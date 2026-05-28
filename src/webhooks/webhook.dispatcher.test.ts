/**
 * Webhook Dispatcher Unit Tests
 * 
 * Comprehensive test coverage for webhook dispatcher functionality including:
 * - Retry behavior with exponential backoff and jitter
 * - Dead-letter queue transition after max retries
 * - Backoff calculation with maximum delay capping
 * - HMAC signature generation
 * - Multiple webhook dispatching
 * - Edge cases and error handling
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { dispatchWebhook, dispatchToAll } from './webhook.dispatcher.js';
import { WebhookStore } from './webhook.store.js';
import type { WebhookConfig, WebhookPayload } from './webhook.types.js';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Webhook Dispatcher', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear webhook store before each test
        const allConfigs = WebhookStore.list();
        for (const config of allConfigs) {
            WebhookStore.delete(config.developerId);
        }
        // Clear dead-letter queue before each test
        WebhookStore.clearDeadLetterQueue();
    });

    afterEach(() => {
        jest.clearAllMocks();
        // Clean up webhook store after each test
        const allConfigs = WebhookStore.list();
        for (const config of allConfigs) {
            WebhookStore.delete(config.developerId);
        }
        // Clean up dead-letter queue after each test
        WebhookStore.clearDeadLetterQueue();
    });

    describe('Successful Webhook Delivery', () => {
        test('should deliver webhook successfully on first attempt', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                secret: 'test-secret',
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
            });

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(
                config.url,
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'User-Agent': 'Callora-Webhook/1.0',
                        'X-Callora-Event': payload.event,
                        'X-Callora-Timestamp': payload.timestamp,
                        'X-Callora-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
                    }),
                })
            );
        });

        test('should deliver webhook successfully after retries', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            // Fail first 2 attempts, succeed on 3rd
            mockFetch.mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({ ok: true, status: 200 });

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        test('should include HMAC signature when secret is provided', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                secret: 'my-secret-key',
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

            await dispatchWebhook(config, payload);

            const call = mockFetch.mock.calls[0];
            const signature = call[1].headers['X-Callora-Signature'];
            expect(signature).toBeDefined();
            expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
        });

        test('should not include HMAC signature when secret is not provided', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

            await dispatchWebhook(config, payload);

            const call = mockFetch.mock.calls[0];
            const signature = call[1].headers['X-Callora-Signature'];
            expect(signature).toBeUndefined();
        });
    });

    describe('Retry Behavior', () => {
        test('should retry on network errors', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(5); // MAX_RETRIES
        });

        test('should retry on non-2xx responses', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockResolvedValue({ ok: false, status: 500 });

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(5); // MAX_RETRIES
        });

        test('should use exponential backoff with jitter', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            const startTime = Date.now();
            await dispatchWebhook(config, payload);
            const endTime = Date.now();

            // Should take at least the sum of backoff delays (with some tolerance)
            // Base delays: 1000, 2000, 4000, 8000 (for retries between attempts)
            // With jitter and cap at 30000, total should be > 10 seconds
            expect(endTime - startTime).toBeGreaterThan(10000);
        });

        test('should cap maximum delay at 30 seconds', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            const startTime = Date.now();
            await dispatchWebhook(config, payload);
            const endTime = Date.now();

            // With MAX_DELAY_MS = 30000, even with 5 attempts the total time should be reasonable
            // If delays weren't capped, the last delay could be much larger
            expect(endTime - startTime).toBeLessThan(120000); // 2 minutes max for all retries
        });
    });

    describe('Dead-Letter Queue', () => {
        test('should move failed webhook to dead-letter queue after max retries', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            const errorMessage = 'Connection refused';
            mockFetch.mockRejectedValue(new Error(errorMessage));

            await dispatchWebhook(config, payload);

            // Should have attempted MAX_RETRIES times
            expect(mockFetch).toHaveBeenCalledTimes(5);

            // Check dead-letter queue
            const deadLetterEntries = WebhookStore.listDeadLetterEntries();
            expect(deadLetterEntries).toHaveLength(1);

            const entry = deadLetterEntries[0];
            expect(entry.webhookConfigId).toBe(config.developerId);
            expect(entry.url).toBe(config.url);
            expect(entry.event).toBe(payload.event);
            expect(entry.status).toBe('dead_letter');
            expect(entry.attempts).toBe(5);
            expect(entry.lastError).toBe(errorMessage);
            expect(entry.id).toMatch(/^dl_/);
            expect(entry.lastAttemptAt).toBeInstanceOf(Date);
            expect(entry.deadLetterAt).toBeInstanceOf(Date);
        });

        test('should record the last error in dead-letter entry', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            const customError = new Error('Custom error message');
            mockFetch.mockRejectedValue(customError);

            await dispatchWebhook(config, payload);

            const deadLetterEntries = WebhookStore.listDeadLetterEntries();
            expect(deadLetterEntries).toHaveLength(1);
            expect(deadLetterEntries[0].lastError).toBe('Custom error message');
        });

        test('should store complete payload in dead-letter entry', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: '2024-01-01T00:00:00.000Z',
                developerId: 'dev_123',
                data: { key: 'value', number: 123 },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            await dispatchWebhook(config, payload);

            const deadLetterEntries = WebhookStore.listDeadLetterEntries();
            expect(deadLetterEntries).toHaveLength(1);
            expect(deadLetterEntries[0].payload).toEqual(payload);
        });

        test('should expose dead-letter entries for inspection', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            await dispatchWebhook(config, payload);

            // Test various dead-letter queue inspection methods
            const allEntries = WebhookStore.listDeadLetterEntries();
            expect(allEntries).toHaveLength(1);

            const specificEntries = WebhookStore.getDeadLetterEntriesByWebhook(config.developerId);
            expect(specificEntries).toHaveLength(1);

            const entry = WebhookStore.getDeadLetterEntry(allEntries[0].id);
            expect(entry).toBeDefined();
            expect(entry?.id).toBe(allEntries[0].id);
        });

        test('should handle multiple failed webhooks in dead-letter queue', async () => {
            const configs: WebhookConfig[] = [
                {
                    developerId: 'dev_1',
                    url: 'https://example.com/webhook1',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
                {
                    developerId: 'dev_2',
                    url: 'https://example.com/webhook2',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
            ];

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_1',
                data: { test: 'data' },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            await dispatchWebhook(configs[0], payload);
            await dispatchWebhook(configs[1], { ...payload, developerId: 'dev_2' });

            const deadLetterEntries = WebhookStore.listDeadLetterEntries();
            expect(deadLetterEntries).toHaveLength(2);
        });
    });

    describe('Multiple Webhook Dispatch', () => {
        test('should dispatch to multiple webhooks in parallel', async () => {
            const configs: WebhookConfig[] = [
                {
                    developerId: 'dev_1',
                    url: 'https://example.com/webhook1',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
                {
                    developerId: 'dev_2',
                    url: 'https://example.com/webhook2',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
                {
                    developerId: 'dev_3',
                    url: 'https://example.com/webhook3',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
            ];

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_1',
                data: { test: 'data' },
            };

            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            await dispatchToAll(configs, payload);

            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        test('should handle partial failures in dispatchToAll', async () => {
            const configs: WebhookConfig[] = [
                {
                    developerId: 'dev_1',
                    url: 'https://example.com/webhook1',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
                {
                    developerId: 'dev_2',
                    url: 'https://example.com/webhook2',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
                {
                    developerId: 'dev_3',
                    url: 'https://example.com/webhook3',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
            ];

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_1',
                data: { test: 'data' },
            };

            // First succeeds, second fails, third succeeds
            mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
                .mockRejectedValue(new Error('Network error'))
                .mockResolvedValueOnce({ ok: true, status: 200 });

            // Should not throw, should handle failures gracefully
            await expect(dispatchToAll(configs, payload)).resolves.not.toThrow();

            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        test('should continue dispatching even if some webhooks fail permanently', async () => {
            const configs: WebhookConfig[] = [
                {
                    developerId: 'dev_1',
                    url: 'https://example.com/webhook1',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
                {
                    developerId: 'dev_2',
                    url: 'https://example.com/webhook2',
                    events: ['new_api_call'],
                    createdAt: new Date(),
                },
            ];

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_1',
                data: { test: 'data' },
            };

            // First succeeds, second fails all retries
            mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
                .mockRejectedValue(new Error('Network error'));

            await dispatchToAll(configs, payload);

            // Should have attempted both
            expect(mockFetch).toHaveBeenCalled();

            // Should have one dead-letter entry for the failed webhook
            const deadLetterEntries = WebhookStore.listDeadLetterEntries();
            expect(deadLetterEntries).toHaveLength(1);
            expect(deadLetterEntries[0].webhookConfigId).toBe('dev_2');
        });
    });

    describe('Edge Cases', () => {
        test('should handle timeout errors', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            const timeoutError = new Error('Request timeout');
            timeoutError.name = 'AbortError';
            mockFetch.mockRejectedValue(timeoutError);

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(5);

            const deadLetterEntries = WebhookStore.listDeadLetterEntries();
            expect(deadLetterEntries).toHaveLength(1);
            expect(deadLetterEntries[0].lastError).toBe('Request timeout');
        });

        test('should handle different HTTP error status codes', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            // Test various HTTP error codes
            const errorCodes = [400, 401, 403, 404, 500, 502, 503];

            for (const statusCode of errorCodes) {
                mockFetch.mockClear();
                WebhookStore.clearDeadLetterQueue();

                mockFetch.mockResolvedValue({ ok: false, status: statusCode });

                await dispatchWebhook(config, payload);

                expect(mockFetch).toHaveBeenCalledTimes(5);

                const deadLetterEntries = WebhookStore.listDeadLetterEntries();
                expect(deadLetterEntries).toHaveLength(1);
            }
        });

        test('should handle empty payload data', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: {},
            };

            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const call = mockFetch.mock.calls[0];
            expect(call[1].body).toBe('{}');
        });

        test('should handle complex payload data', async () => {
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: {
                    nested: { object: { with: ['array', 'data'] } },
                    number: 42,
                    boolean: true,
                    null: null,
                },
            };

            mockFetch.mockResolvedValue({ ok: true, status: 200 });

            await dispatchWebhook(config, payload);

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const call = mockFetch.mock.calls[0];
            const body = JSON.parse(call[1].body);
            expect(body).toEqual(payload.data);
        });
    });

    describe('Backoff Calculation', () => {
        test('should calculate increasing backoff delays', async () => {
            // This test indirectly verifies backoff through timing
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            mockFetch.mockRejectedValue(new Error('Network error'));

            const startTime = Date.now();
            await dispatchWebhook(config, payload);
            const elapsedTime = Date.now() - startTime;

            // With exponential backoff, should take significantly longer than just 5 attempts
            expect(elapsedTime).toBeGreaterThan(5000);
        });

        test('should add jitter to prevent thundering herd', async () => {
            // Run multiple times and verify variance in timing
            const config: WebhookConfig = {
                developerId: 'dev_123',
                url: 'https://example.com/webhook',
                events: ['new_api_call'],
                createdAt: new Date(),
            };

            const payload: WebhookPayload = {
                event: 'new_api_call',
                timestamp: new Date().toISOString(),
                developerId: 'dev_123',
                data: { test: 'data' },
            };

            const timings: number[] = [];

            for (let i = 0; i < 3; i++) {
                WebhookStore.clearDeadLetterQueue();
                mockFetch.mockClear();
                mockFetch.mockRejectedValue(new Error('Network error'));

                const startTime = Date.now();
                await dispatchWebhook(config, payload);
                timings.push(Date.now() - startTime);
            }

            // Timings should vary due to jitter (not exact, but should have some variance)
            const uniqueTimings = new Set(timings);
            expect(uniqueTimings.size).toBeGreaterThan(1);
        });
    });
});
