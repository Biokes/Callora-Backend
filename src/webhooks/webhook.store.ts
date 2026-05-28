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

    /** Clear all webhook configurations - for testing only */
    clear(): void {
        store.clear();
    },
};
