/* SPDX-License-Identifier: MIT; Copyright (c) 2026 nyxxbit and contributors */
import { RestAPI } from "@webpack/common";

import { companionFailure, COMPANION_EVENT_CODES, emitCompanionEvent } from "./companionEvents";
import { setAutoClaimHook } from "./hooks";
import { canClaimReward, RewardClaimer, type RewardClaimState } from "./rewardClaimer";
import { settings } from "./settings";
import { trafficMetadataSealed } from "./util";

let claimer: RewardClaimer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let store: any = null;
let currentAccount: () => string | null = () => null;
let hintOwner: string | null = null;
const completedHints = new Set<string>();
const listeners = new Set<() => void>();

function quests(): any[] {
    const account = currentAccount();
    if (account && account !== hintOwner) {
        completedHints.clear();
        hintOwner = account;
    }
    const values = store?.quests;
    const all: any[] = typeof values?.values === "function" ? Array.from(values.values()) : Object.values(values ?? {});
    return all.map(quest => completedHints.has(quest.id) && account === hintOwner
        ? { ...quest, userStatus: { ...quest.userStatus, completedAt: quest.userStatus?.completedAt ?? "engine-completed" } } : quest);
}

function notifyListeners() {
    for (const listener of listeners) {
        try { listener(); } catch { console.error("[OrionQuests] Reward view failed."); }
    }
}

function changed(state: RewardClaimState) {
    const quest = quests().find(q => q.id === state.id);
    const code = state.status === "CLAIMED" ? COMPANION_EVENT_CODES.CLAIM_SUCCEEDED
        : state.status === "ACTION_REQUIRED" ? COMPANION_EVENT_CODES.CLAIM_ACTION_REQUIRED
            : state.status === "FAILED" ? COMPANION_EVENT_CODES.CLAIM_FAILED : null;
    if (code) emitCompanionEvent({
        code, category: "claim", level: state.status === "CLAIMED" ? "success" : "warning",
        message: state.status, questId: state.id, questName: quest?.config?.messages?.questName,
        failure: state.status === "CLAIMED" ? undefined : companionFailure({
            terminal: true, retryable: false, httpStatus: state.httpStatus,
            attempt: state.attempts || undefined, maxAttempts: state.attempts || undefined,
            reason: state.status === "ACTION_REQUIRED" ? "Требуется подтверждение в Discord" : "Получение награды не подтверждено",
        }),
    });
    notifyListeners();
}

function wake() {
    void claimer?.tick().catch(() => console.error("[OrionQuests] Reward scan failed."));
}

export function initializeRewardClaims(questStore: any, accountId: () => string | null) {
    destroyRewardClaims();
    store = questStore;
    currentAccount = accountId;
    claimer = new RewardClaimer({
        accountId,
        enabled: () => settings.store.tryToClaimReward,
        quests,
        post: id => RestAPI.post({
            url: `/quests/${id}/claim-reward`,
            body: { platform: 0, location: 11, is_targeted: false, metadata_sealed: null, traffic_metadata_sealed: trafficMetadataSealed(store, id) },
        }),
        changed,
    });
    store?.addChangeListener?.(wake);
    setAutoClaimHook(enabled => { if (enabled) claimer?.resume(); wake(); });
    timer = setInterval(wake, 1000);
    wake();
}

export function destroyRewardClaims() {
    if (timer) clearInterval(timer);
    timer = null;
    store?.removeChangeListener?.(wake);
    claimer?.destroy();
    claimer = null;
    store = null;
    currentAccount = () => null;
    hintOwner = null;
    completedHints.clear();
    setAutoClaimHook(null);
}

export function readRewardClaims(): RewardClaimState[] {
    return claimer?.read() ?? [];
}

export function subscribeRewardClaims(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function collectRewards(id?: string): string {
    const candidates = quests().filter(q => canClaimReward(q) && (!id || q.id === id));
    const count = claimer?.request(candidates.map(q => q.id)) ?? 0;
    wake();
    return count ? `Наград в очереди получения: ${count}.` : "Нет новых наград для получения. Если нужно подтверждение, откройте задания Discord.";
}

export function notifyRewardCompleted(id: string) {
    // VIDEO progress responses can reach the engine before QuestStore receives its gateway update.
    quests();
    if (!currentAccount()) return;
    completedHints.add(id);
    wake();
}

export function rewardClaimsSuspended(): boolean { return claimer?.isSuspended() ?? false; }
export function suspendRewardClaims() { claimer?.suspend(); notifyListeners(); }
export function resumeRewardClaims() { claimer?.resume(); wake(); }
