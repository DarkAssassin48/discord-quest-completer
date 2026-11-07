/* SPDX-License-Identifier: MIT; Copyright (c) 2026 nyxxbit and contributors */

export interface RewardQuest {
    id: string;
    config?: { rewardsConfig?: { expiresAt?: string; }; };
    userStatus?: { completedAt?: string; claimedAt?: string; };
}

export type ClaimStatus = "QUEUED" | "CLAIMING" | "RETRY" | "CLAIMED" | "ACTION_REQUIRED" | "FAILED";

export interface RewardClaimState {
    id: string;
    status: ClaimStatus;
    attempts: number;
    retryAt: number;
    httpStatus?: number;
}

interface ClaimDependencies {
    accountId(): string | null;
    enabled(): boolean;
    quests(): RewardQuest[];
    post(questId: string): Promise<any>;
    changed(state: RewardClaimState): void;
}

export function canClaimReward(quest: RewardQuest, now = Date.now()): boolean {
    const expires = Date.parse(quest.config?.rewardsConfig?.expiresAt ?? "");
    return !!quest.userStatus?.completedAt && !quest.userStatus.claimedAt
        && (!Number.isFinite(expires) || expires > now);
}

export class RewardClaimer {
    private states = new Map<string, RewardClaimState>();
    private manual = new Set<string>();
    private owner: string | null = null;
    private generation = 0;
    private busy = false;
    private notBefore = 0;
    private active = true;
    private suspended = false;

    constructor(private readonly deps: ClaimDependencies) { }

    private reconcile(): string | null {
        const account = this.deps.accountId();
        if (account && account !== this.owner) {
            this.owner = account;
            this.generation++;
            this.states.clear();
            this.manual.clear();
            this.notBefore = 0;
        }
        return account;
    }

    read(): RewardClaimState[] {
        if (!this.reconcile()) return [];
        return Array.from(this.states.values());
    }

    request(ids: string[], now = Date.now()): number {
        if (!this.active || !this.reconcile()) return 0;
        this.suspended = false;
        const eligible = new Set(this.deps.quests().filter(q => canClaimReward(q, now)).map(q => q.id));
        let count = 0;
        for (const id of ids) {
            if (!eligible.has(id)) continue;
            const previous = this.states.get(id);
            if (previous?.status === "CLAIMED" || previous?.status === "CLAIMING" || previous?.status === "ACTION_REQUIRED") continue;
            if (previous?.status === "QUEUED" || previous?.status === "RETRY") {
                if (!this.manual.has(id)) { this.manual.add(id); count++; }
                continue;
            }
            this.manual.add(id);
            this.publish({ id, status: "QUEUED", attempts: 0, retryAt: 0 });
            count++;
        }
        return count;
    }

    suspend(): void {
        this.suspended = true;
        this.manual.clear();
    }

    resume(): void {
        this.suspended = false;
    }

    isSuspended(): boolean { return this.suspended; }

    destroy(): void {
        this.active = false;
        this.generation++;
        this.states.clear();
        this.manual.clear();
    }

    private publish(state: RewardClaimState): void {
        this.states.set(state.id, state);
        this.deps.changed({ ...state });
    }

    async tick(now = Date.now()): Promise<void> {
        const account = this.reconcile();
        if (!this.active || !account || this.suspended || this.busy || now < this.notBefore) return;
        const generation = this.generation;
        const valid = () => this.active && this.generation === generation && this.deps.accountId() === account;
        const quests = this.deps.quests();
        for (const quest of quests) {
            if (quest.userStatus?.claimedAt && this.states.has(quest.id) && this.states.get(quest.id)?.status !== "CLAIMED") {
                this.manual.delete(quest.id);
                this.publish({ id: quest.id, status: "CLAIMED", attempts: 0, retryAt: 0 });
            }
        }
        const quest = quests.find(q => {
            if (!canClaimReward(q, now) || (!this.deps.enabled() && !this.manual.has(q.id))) return false;
            const state = this.states.get(q.id);
            return !state || state.status === "QUEUED" || (state.status === "RETRY" && state.retryAt <= now);
        });
        if (!quest || !valid()) return;

        this.busy = true;
        const attempts = (this.states.get(quest.id)?.attempts ?? 0) + 1;
        this.publish({ id: quest.id, status: "CLAIMING", attempts, retryAt: 0 });
        try {
            // A subscriber can disable the setting or stop Orion while observing CLAIMING.
            if (!valid() || this.suspended || (!this.deps.enabled() && !this.manual.has(quest.id))) {
                if (valid()) this.publish({ id: quest.id, status: "QUEUED", attempts: attempts - 1, retryAt: 0 });
                return;
            }
            const response = await this.deps.post(quest.id);
            if (!valid()) return;
            const confirmed = response?.body?.claimed_at || response?.body?.claimedAt
                || this.deps.quests().find(q => q.id === quest.id)?.userStatus?.claimedAt;
            if (confirmed) {
                this.manual.delete(quest.id);
                this.publish({ id: quest.id, status: "CLAIMED", attempts, retryAt: 0 });
            } else {
                this.publish({ id: quest.id, status: attempts < 4 ? "RETRY" : "FAILED", attempts, retryAt: now + 5000 * attempts });
            }
        } catch (error: any) {
            if (!valid()) return;
            const status = Number(error?.status ?? error?.statusCode) || undefined;
            const captcha = !!(error?.body?.captcha_key || error?.body?.captcha_sitekey);
            const retryable = !status || status === 408 || status === 429 || status >= 500;
            const retryAfter = Number(error?.body?.retry_after);
            const delay = status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.max(1500, retryAfter * 1000) : Math.min(60000, 5000 * 2 ** (attempts - 1));
            if (status === 429) this.notBefore = now + delay;
            this.publish({
                id: quest.id,
                status: captcha || status === 400 || status === 401 || status === 403 ? "ACTION_REQUIRED"
                    : retryable && attempts < 4 ? "RETRY" : "FAILED",
                attempts,
                retryAt: now + delay,
                httpStatus: status,
            });
        } finally {
            this.busy = false;
            if (this.active && this.generation === generation && this.deps.accountId() === null
                && this.states.get(quest.id)?.status === "CLAIMING") {
                this.publish({ id: quest.id, status: attempts < 4 ? "RETRY" : "FAILED", attempts, retryAt: now + 5000 });
            }
            if (valid()) this.notBefore = Math.max(this.notBefore, now + 1500);
        }
    }
}
