/* SPDX-License-Identifier: MIT; Copyright (c) 2026 nyxxbit and contributors */
import { OptionType } from "@utils/types";

import { subscribeCompanionEvents, type CompanionEvent } from "./companionEvents";
import { canUseMoreQuestOrbs, getCurrentUserId, getQuestStore, isEngineRunning, listQuests, readDashboard, subscribeDashboard, type DashboardEntry } from "./orion";
import { selectQuestTaskConfig, selectTaskFamily, taskEntries } from "./questConfig";
import { formatOrbReward, questOrbReward } from "./questRewards";
import { canClaimReward } from "./rewardClaimer";
import { collectRewards, readRewardClaims, rewardClaimsSuspended, subscribeRewardClaims } from "./rewardService";
import { settings } from "./settings";
import { eventTextRu, isDashboardShortcut, progressRu, statusRu, taskTypeRu } from "./uiRu";

interface Controls {
    start(ids?: string[]): Promise<string>;
    stop(): Promise<string>;
    pause(): Promise<string>;
    resume(): Promise<string>;
    quests(): void;
}

interface Card extends DashboardEntry {
    rewardType: string;
    reward: string;
    selected: boolean;
}

const icons: Record<string, string> = {
    BOLT: '<path d="m13 2-3 8H4l7 12 3-8h6L13 2Z"/>',
    GAME: '<path d="M6 7h12l3 11-3 1-4-4h-4l-4 4-3-1L6 7Z"/><path d="M7 10v4m-2-2h4m6-1h.01M18 13h.01"/>',
    WATCH_VIDEO: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
    STREAM: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-2-13 5 3-5 3V8Z"/>',
    ACTIVITY: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    ACHIEVEMENT: '<path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm4 10v7m-4 1h8M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4"/>',
    CHECK: '<path d="m5 12 4 4L19 6"/>',
    CLOCK: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    STOP: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    OPTIONS: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
};

let controls: Controls | null = null;
let panel: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let logs: HTMLDivElement | null = null;
let notice: HTMLDivElement | null = null;
let settingsOpen = false;
let collapsed = false;
let selectionOwner: string | null = null;
let selected = new Map<string, boolean>();
const rewardFilters = new Set<string>();
const typeFilters = new Set<string>();
const events: CompanionEvent[] = [];
let cleanups: Array<() => void> = [];
let stopDragging: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function icon(name: string): HTMLSpanElement {
    const node = el("span", "orion-icon");
    // Only constant SVG paths above enter this markup; quest names always use textContent.
    node.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.BOLT}</svg>`;
    return node;
}

function button(text: string, action: () => unknown | Promise<unknown>, className = ""): HTMLButtonElement {
    const node = el("button", className, text);
    node.type = "button";
    node.addEventListener("click", async () => {
        node.disabled = true;
        try {
            const result = await action();
            if (typeof result === "string" && notice) notice.textContent = result;
        } catch {
            if (notice) notice.textContent = "Не удалось выполнить действие. Попробуйте ещё раз.";
        } finally { node.disabled = false; render(); }
    });
    return node;
}

function cardData(): Card[] {
    const account = getCurrentUserId();
    if (account && account !== selectionOwner) {
        selected.clear();
        if (selectionOwner !== null) {
            events.length = 0;
            renderLogs();
        }
        selectionOwner = account;
    }
    const active = new Map(readDashboard().map(entry => [entry.id, entry]));
    const claims = new Map(readRewardClaims().map(state => [state.id, state]));
    const result: Card[] = [];
    for (const quest of listQuests()) {
        const current = active.get(quest.id);
        active.delete(quest.id);
        const claim = claims.get(quest.id);
        const claimed = !!quest.userStatus?.claimedAt || claim?.status === "CLAIMED";
        if (claimed && !claim) continue;
        const expiry = Date.parse(quest.config?.expiresAt ?? "");
        if (!current && !quest.userStatus?.completedAt && Number.isFinite(expiry) && expiry <= Date.now()) continue;
        const config = selectQuestTaskConfig(quest.config);
        const family = selectTaskFamily(taskEntries(config?.tasks).map(([key]) => key));
        if (!family && !current && !quest.userStatus?.completedAt) continue;
        const key = family?.keyName ?? "";
        const task = taskEntries(config?.tasks).find(([name]) => name === key)?.[1];
        const payout = questOrbReward(quest.config);
        const rewards = quest.config?.rewardsConfig?.rewards ?? [];
        const rewardType = payout ? "ORBS" : rewards.some(r => r.type === 3) ? "DECORATION" : rewards.some(r => r.type === 1) ? "IN_GAME" : "OTHER";
        const status = claimed ? "CLAIMED" : quest.userStatus?.completedAt ? "COMPLETED" : current?.status ?? "PENDING";
        if (!selected.has(quest.id)) selected.set(quest.id, true);
        result.push({
            id: quest.id, name: quest.config?.messages?.questName ?? "Задание Discord", type: family?.type ?? "GAME",
            cur: quest.userStatus?.progress?.[key]?.value ?? 0, max: task?.target ?? 0,
            ...current, status,
            claimable: !claimed && (canClaimReward(quest) || current?.claimable === true),
            rewardType, reward: formatOrbReward(payout, canUseMoreQuestOrbs()) || rewards[0]?.messages?.name || "Другая награда",
            selected: selected.get(quest.id) === true,
        });
    }
    for (const current of active.values()) result.push({ ...current, selected: true, rewardType: "OTHER", reward: "" });
    return result;
}

function visible(card: Card): boolean {
    return !rewardFilters.has(card.rewardType) && !typeFilters.has(card.type);
}

function renderCard(card: Card, picker: boolean): HTMLElement {
    const claim = readRewardClaims().find(state => state.id === card.id);
    const done = card.status === "COMPLETED" || card.status === "CLAIMED";
    const pending = ["PENDING", "QUEUE", "PAUSED", "STOPPED"].includes(card.status);
    const failed = card.status === "FAILED";
    const node = el(picker ? "label" : "div", picker ? "quest-pick" : `task-card ${done ? "done" : failed ? "failed" : pending ? "pending" : "running"}`);
    node.dataset.questId = card.id;
    node.dataset.status = card.status;
    if (picker) {
        node.style.setProperty("--state-color", card.rewardType === "ORBS" ? "#5865f2" : card.rewardType === "DECORATION" ? "#a358f2" : "#e67e22");
        const check = el("input", "native-cb");
        check.type = "checkbox";
        check.checked = card.selected;
        check.setAttribute("aria-label", `Выбрать: ${card.name}`);
        check.addEventListener("change", () => { selected.set(card.id, check.checked); render(); });
        node.append(check);
    } else {
        const circle = el("div", "task-icon");
        const percent = card.max > 0 && Number.isFinite(card.cur / card.max) ? Math.min(100, Math.max(0, card.cur / card.max * 100)) : 0;
        circle.style.setProperty("--p", `${percent}%`);
        circle.append(icon(done ? "CHECK" : failed ? "STOP" : pending ? "CLOCK" : card.type), el("span", "task-icon-overlay", `${Math.floor(percent)}%`));
        node.append(circle);
    }
    const info = el("div", "task-info");
    const status = claim?.status === "CLAIMING" ? "Получение награды…"
        : claim?.status === "QUEUED" ? "В очереди получения"
            : claim?.status === "ACTION_REQUIRED" ? "Нужно подтверждение Discord"
                : claim?.status === "FAILED" ? "Награда не получена"
                    : claim?.status === "RETRY" ? `Повтор через ${Math.max(0, Math.ceil((claim.retryAt - Date.now()) / 1000))} с`
                        : statusRu[card.status] ?? "Состояние обновляется";
    const name = el("div", "task-name", card.name);
    name.title = card.name;
    if (!picker) info.append(el("div", "task-status", status));
    info.append(name);
    const meta = el("div", "task-meta");
    meta.append(el("span", "", taskTypeRu[card.type] ?? "Задание"), el("span", "reward-value", card.reward));
    info.append(meta);
    if (!picker && !done) info.append(el("div", "task-meta", progressRu(card.cur, card.max, card.type)));
    node.append(info);
    if (card.claimable) {
        const actions = el("div", "task-actions");
        if (claim?.status === "ACTION_REQUIRED") actions.append(button("Открыть ↗", () => controls?.quests(), "goto-btn"));
        else {
            const collecting = claim && ["CLAIMING", "QUEUED", "RETRY"].includes(claim.status);
            const action = button(collecting ? "Ожидание…" : claim?.status === "FAILED" ? "Повторить" : "Забрать", () => collectRewards(card.id), "claim-btn");
            action.disabled = !!collecting;
            actions.append(action);
        }
        node.append(actions);
    } else if (card.actionRequired === "ENROLL") node.append(button("Принять ↗", () => controls?.quests(), "goto-btn"));
    return node;
}

function renderFilters(cards: Card[]) {
    const filters = el("div", "orion-filters");
    const rewards: Record<string, string> = { ORBS: "Orbs", IN_GAME: "В игре", DECORATION: "Украшения", OTHER: "Другое" };
    for (const [key, title] of Object.entries(rewards)) {
        const count = cards.filter(card => card.rewardType === key).length;
        if (count) filters.append(button(`${title} (${count})`, () => { if (rewardFilters.has(key)) rewardFilters.delete(key); else rewardFilters.add(key); }, `reward-filter ${rewardFilters.has(key) ? "off" : ""}`));
    }
    for (const key of new Set(cards.map(card => card.type))) filters.append(button(taskTypeRu[key], () => {
        if (typeFilters.has(key)) typeFilters.delete(key); else typeFilters.add(key);
    }, `type-filter ${typeFilters.has(key) ? "off" : ""}`));
    return filters;
}

function render() {
    if (!panel || panel.hidden || !body || settingsOpen) return;
    const cards = cardData();
    const running = isEngineRunning();
    const picker = !running;
    body.replaceChildren();
    const summary = el("div", "orion-summary");
    summary.append(el("span", running ? "running-text" : "", running ? "● Выполняется" : "Выберите задания"));
    const claiming = settings.store.tryToClaimReward && !rewardClaimsSuspended();
    summary.append(el("span", claiming ? "running-text" : "", `Автосбор: ${claiming ? "вкл." : rewardClaimsSuspended() ? "пауза" : "выкл."}`));
    body.append(summary, renderFilters(cards));
    const list = el("div", "picker-quest-list");
    const filtered = cards.filter(visible);
    for (const card of filtered) list.append(renderCard(card, picker && !card.claimable && card.status !== "CLAIMED"));
    if (!filtered.length) list.append(el("div", "orion-empty", cards.length ? "Нет заданий с выбранными фильтрами." : "Нет доступных заданий. Откройте задания Discord, чтобы загрузить список."));
    body.append(list);
    const chosen = filtered.filter(card => card.selected && !["COMPLETED", "CLAIMED"].includes(card.status));
    const total = chosen.reduce((sum, card) => sum + (questOrbReward(listQuests().find(q => q.id === card.id)?.config)?.[canUseMoreQuestOrbs() ? "premiumOrbs" : "orbs"] ?? 0), 0);
    if (picker) body.append(el("div", "orb-total", `Выбрано: ${chosen.length}${total ? ` · ${total.toLocaleString("ru-RU")} Orbs` : ""}`));
    const actions = el("div", "picker-actions");
    if (picker) {
        actions.append(button(chosen.length === filtered.filter(card => !["COMPLETED", "CLAIMED"].includes(card.status)).length ? "Снять выбор" : "Выбрать все", () => {
            const select = chosen.length < filtered.filter(card => !["COMPLETED", "CLAIMED"].includes(card.status)).length;
            for (const card of filtered) selected.set(card.id, select);
        }, "quest-pick-btn deselect"));
        const start = button(`Запустить (${chosen.length})`, () => controls?.start(chosen.map(card => card.id)), "quest-pick-btn start");
        start.disabled = chosen.length === 0;
        actions.append(start);
    } else actions.append(button("Пауза", () => controls?.pause(), "quest-pick-btn deselect"), button("Продолжить", () => controls?.resume(), "quest-pick-btn start"));
    const rewardActions = el("div", "orion-reward-actions");
    const claimable = cards.filter(card => card.claimable).length;
    const collect = button(`Забрать всё${claimable ? ` (${claimable})` : ""}`, () => collectRewards(), "claim-btn");
    collect.disabled = claimable === 0;
    rewardActions.append(collect, button("Задания Discord ↗", () => controls?.quests(), "orion-link"));
    body.append(actions, rewardActions);
}

function renderSettings() {
    if (!body) return;
    body.replaceChildren(el("div", "picker-section-title", "Настройки Orion"));
    const values = settings.store as unknown as Record<string, unknown>;
    for (const [key, def] of Object.entries(settings.def)) {
        const row = el("label", "orion-setting");
        const top = el("div", "orion-option");
        top.append(el("span", "orion-option-label", def.displayName ?? key));
        if (def.type === OptionType.BOOLEAN) {
            const input = el("input", "native-toggle");
            input.type = "checkbox";
            input.checked = values[key] === true;
            input.addEventListener("change", () => { values[key] = input.checked; });
            top.append(input);
        } else if (def.type === OptionType.SLIDER) {
            const input = el("select");
            for (const marker of def.markers) {
                const option = el("option", "", String(marker));
                option.value = String(marker);
                input.append(option);
            }
            input.value = String(values[key] ?? def.default);
            input.addEventListener("change", () => { values[key] = Number(input.value); });
            top.append(input);
        }
        row.append(top, el("span", "orion-description", def.description));
        body.append(row);
    }
    body.append(el("div", "orion-description", "Изменения сохраняются сразу."), button("← К заданиям", toggleSettings, "quest-pick-btn deselect"));
}

function toggleSettings() {
    settingsOpen = !settingsOpen;
    if (settingsOpen) renderSettings(); else render();
}

function renderLogs() {
    if (!logs) return;
    logs.replaceChildren();
    for (const event of events) {
        const row = el("div", `log-item ${event.level}`);
        row.append(el("time", "log-ts", new Date(event.timestamp).toLocaleTimeString("ru-RU")), el("span", "", eventTextRu(event)));
        logs.append(row);
    }
    if (!events.length) logs.append(el("div", "orion-description", "Журнал событий появится здесь."));
    logs.scrollTop = logs.scrollHeight;
}

function clampPosition() {
    if (!panel || !panel.style.left) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - rect.width))}px`;
    panel.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - Math.min(rect.height, 100)))}px`;
}

function ensurePanel() {
    if (panel) return;
    panel = el("div");
    panel.id = "orion-vencord-ru";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Orion — задания и награды");
    panel.lang = "ru";
    const header = el("div");
    header.id = "orion-head";
    const title = el("div", "orion-title");
    const titleText = el("span", "", "Orion");
    titleText.append(el("span", "dev-credit", "автор: syntt_"), el("span", "orion-version", "4.11.5-ru.2"));
    title.append(icon("BOLT"), titleText);
    const actions = el("div", "orion-controls");
    const stop = button("Стоп", () => controls?.stop(), "ctrl-btn ctrl-stop");
    stop.title = "Остановить задания и автосбор";
    const hide = button("Скрыть", hideDashboard, "ctrl-btn ctrl-hide");
    hide.title = "Shift + . — показать / скрыть";
    const options = button("", toggleSettings, "ctrl-btn ctrl-opts");
    options.title = "Настройки Orion";
    options.setAttribute("aria-label", "Настройки Orion");
    options.append(icon("OPTIONS"));
    actions.append(stop, hide, options);
    header.append(title, actions);
    header.addEventListener("dblclick", event => {
        if ((event.target as HTMLElement).closest("button")) return;
        collapsed = !collapsed;
        panel?.classList.toggle("collapsed", collapsed);
    });
    header.addEventListener("pointerdown", event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button") || !panel) return;
        stopDragging?.();
        const rect = panel.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        header.classList.add("dragging");
        const move = (next: PointerEvent) => {
            if (!panel) return;
            panel.style.left = `${rect.left + next.clientX - startX}px`;
            panel.style.top = `${rect.top + next.clientY - startY}px`;
            panel.style.right = "auto";
            clampPosition();
        };
        stopDragging = () => {
            header.classList.remove("dragging");
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", stop);
            document.removeEventListener("pointercancel", stop);
            stopDragging = null;
        };
        const stop = () => stopDragging?.();
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
        document.addEventListener("pointercancel", stop);
        event.preventDefault();
    });
    body = el("div");
    body.id = "orion-body";
    notice = el("div", "orion-notice");
    notice.setAttribute("role", "status");
    logs = el("div");
    logs.id = "orion-logs";
    logs.setAttribute("role", "log");
    logs.setAttribute("aria-label", "Журнал событий Orion");
    panel.append(header, body, notice, logs);
    document.body.append(panel);
    renderLogs();
}

export function showDashboard() {
    if (!controls) return;
    ensurePanel();
    panel!.hidden = false;
    if (settingsOpen) renderSettings(); else render();
    clampPosition();
}

export function hideDashboard() { if (panel) panel.hidden = true; }
export function toggleDashboard() { if (!panel || panel.hidden) showDashboard(); else hideDashboard(); }

function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (isDashboardShortcut(event)) {
        event.preventDefault();
        toggleDashboard();
    } else if (event.key === "Escape") hideDashboard();
}

export function initializeDashboard(value: Controls) {
    controls = value;
    cleanups.push(subscribeDashboard(render), subscribeRewardClaims(render), subscribeCompanionEvents(event => {
        events.push(event);
        if (events.length > 80) events.shift();
        renderLogs();
    }));
    const store = getQuestStore();
    store?.addChangeListener?.(render);
    cleanups.push(() => store?.removeChangeListener?.(render));
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", clampPosition);
    refreshTimer = setInterval(() => { if (readRewardClaims().some(state => state.status === "RETRY")) render(); }, 1000);
}

export function destroyDashboard() {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    stopDragging?.();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", clampPosition);
    panel?.remove();
    panel = body = logs = notice = null;
    controls = null;
    settingsOpen = collapsed = false;
    selectionOwner = null;
    selected = new Map();
    rewardFilters.clear();
    typeFilters.clear();
    events.length = 0;
}
