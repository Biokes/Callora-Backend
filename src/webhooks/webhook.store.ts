import { WebhookConfig, WebhookEventType, DeadLetterEntry } from './webhook.types.js';

const store = new Map<string, WebhookConfig>();
const deadLetterStore = new Map<string, DeadLetterEntry>();

export const WebhookStore = {
    register(config: WebhookConfig): void {
        store.set(config.developerId, config);
    },

    get(developerId: string): WebhookConfig | undefined {
        return store.get(developerId);
    },

    delete(developerId: string): void {
        store.delete(developerId);
    },

    getByEvent(event: WebhookEventType): WebhookConfig[] {
        return [...store.values()].filter((cfg) => cfg.events.includes(event));
    },

    list(): WebhookConfig[] {
        return [...store.values()];
    },

    // Dead-letter queue management
    addDeadLetterEntry(entry: DeadLetterEntry): void {
        deadLetterStore.set(entry.id, entry);
    },

    getDeadLetterEntry(id: string): DeadLetterEntry | undefined {
        return deadLetterStore.get(id);
    },

    listDeadLetterEntries(): DeadLetterEntry[] {
        return [...deadLetterStore.values()];
    },

    getDeadLetterEntriesByWebhook(webhookConfigId: string): DeadLetterEntry[] {
        return [...deadLetterStore.values()].filter(
            (entry) => entry.webhookConfigId === webhookConfigId
        );
    },

    removeDeadLetterEntry(id: string): void {
        deadLetterStore.delete(id);
    },

    clearDeadLetterQueue(): void {
        deadLetterStore.clear();
    },
};
