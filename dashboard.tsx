/* SPDX-License-Identifier: MIT; Copyright (c) 2026 nyxxbit and contributors */
import "./dashboard.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { React } from "@webpack/common";

import { subscribeCompanionEvents, type CompanionEvent } from "./companionEvents";
import { getQuestStore, isEngineRunning, listQuests, readDashboard, subscribeDashboard, type DashboardEntry } from "./orion";
import { settings } from "./settings";
import { eventTextRu, progressRu, statusRu, taskTypeRu } from "./uiRu";

interface Controls {
    start(): Promise<string>;
    stop(): Promise<string>;
    pause(): Promise<string>;
    resume(): Promise<string>;
    quests(): void;
}

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');
let controls: Controls | null = null;
let panel: HTMLDivElement | null = null;
let cards: HTMLDivElement | null = null;
let logElement: HTMLDivElement | null = null;
let stateElement: HTMLSpanElement | null = null;
let contentElement: HTMLDivElement | null = null;
let settingsPane: HTMLDivElement | null = null;
let startButton: HTMLButtonElement | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeEvents: (() => void) | null = null;
let questStore: any = null;
let onStoreChanged: (() => void) | null = null;
const events: CompanionEvent[] = [];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
}

function button(text: string, action: () => void | Promise<unknown>, className = ""): HTMLButtonElement {
    const el = element("button", className, text);
    el.type = "button";
    el.addEventListener("click", async () => {
        el.disabled = true;
        try {
            const result = await action();
            if (typeof result === "string") logElement?.append(element("div", "orion-ru-notice", result));
        }
        catch (error) {
            const message = element("div", "orion-ru-notice error", "Не удалось выполнить действие. Подробности записаны в консоль.");
            logElement?.prepend(message);
            console.error("[OrionQuests] UI action failed:", error);
        } finally { el.disabled = false; render(); }
    });
    return el;
}

function availableEntries(): DashboardEntry[] {
    const active = readDashboard();
    if (active.length) return active;
    return listQuests().filter((q: any) => {
        const expiry = Date.parse(q.config?.expiresAt ?? "");
        return !q.userStatus?.claimedAt && (!Number.isFinite(expiry) || expiry > Date.now());
    }).map((q: any) => {
        const tasks = q.config?.taskConfigV2?.tasks ?? q.config?.taskConfig?.tasks ?? {};
        const key = Object.keys(tasks)[0] ?? "";
        const type = key.includes("VIDEO") ? "WATCH_VIDEO" : key.includes("STREAM") ? "STREAM" : key.includes("ACHIEVEMENT") ? "ACHIEVEMENT" : key.includes("ACTIVITY") ? "ACTIVITY" : "GAME";
        return { id: q.id, name: q.config?.messages?.questName ?? "Задание Discord", type, max: tasks[key]?.target ?? 0, cur: q.userStatus?.progress?.[key]?.value ?? 0, status: q.userStatus?.completedAt ? "COMPLETED" : "PENDING", claimable: !!q.userStatus?.completedAt };
    });
}

function render() {
    if (!panel || !cards || !stateElement || !startButton) return;
    const running = isEngineRunning();
    stateElement.textContent = running ? "Работает" : "Готов к запуску";
    stateElement.dataset.running = String(running);
    startButton.disabled = running;
    const entries = availableEntries();
    cards.replaceChildren();
    if (!entries.length) cards.append(element("div", "orion-ru-empty", "Нет доступных заданий. Откройте раздел «Задания» в Discord, чтобы загрузить список."));
    for (const entry of entries) {
        const card = element("div", "orion-ru-card");
        card.dataset.status = entry.status;
        card.append(element("span", "orion-ru-task-icon", entry.type === "WATCH_VIDEO" ? "▶" : entry.status === "COMPLETED" ? "✓" : "ϟ"));
        const details = element("div", "orion-ru-task-details");
        details.append(element("div", "orion-ru-status", statusRu[entry.status] ?? "Состояние обновляется"));
        details.append(element("div", "orion-ru-task-name", entry.name));
        details.append(element("div", "orion-ru-task-meta", `${taskTypeRu[entry.type] ?? "Задание"} · ${progressRu(entry.cur, entry.max, entry.type)}`));
        if (entry.max > 0) {
            const progress = element("progress");
            progress.max = entry.max;
            progress.value = Math.min(entry.cur, entry.max);
            progress.setAttribute("aria-label", "Прогресс задания");
            details.append(progress);
        }
        if (entry.claimable || entry.status === "PENDING") details.append(button("Открыть задание", () => controls?.quests(), "orion-ru-inline"));
        card.append(details);
        cards.append(card);
    }
}

function appendEvent(event: CompanionEvent) {
    events.push(event);
    if (events.length > 80) events.shift();
    renderEventLogs();
}

function renderEventLogs() {
    if (!logElement) return;
    logElement.replaceChildren();
    for (const item of events) {
        const row = element("div", `orion-ru-log-row ${item.level}`);
        row.append(element("time", "", new Date(item.timestamp).toLocaleTimeString("ru-RU")));
        row.append(element("span", "", eventTextRu(item)));
        logElement.append(row);
    }
    logElement.scrollTop = logElement.scrollHeight;
}

function toggleSettings() {
    if (!panel || !contentElement || !settingsPane) return;
    const show = settingsPane.hidden;
    settingsPane.hidden = !show;
    contentElement.hidden = show;
    if (!show) return;
    settingsPane.replaceChildren(element("div", "orion-ru-settings-title", "Настройки Orion"));
    const values = settings.store as unknown as Record<string, unknown>;
    for (const [key, definition] of Object.entries(settings.def)) {
        const row = element("label", "orion-ru-setting");
        const top = element("div", "orion-ru-setting-top");
        top.append(element("span", "", definition.displayName ?? key));
        if (definition.type === OptionType.BOOLEAN) {
            const input = element("input");
            input.type = "checkbox";
            input.checked = values[key] === true;
            input.addEventListener("change", () => { values[key] = input.checked; });
            top.append(input);
        } else if (definition.type === OptionType.SLIDER) {
            const select = element("select");
            for (const marker of definition.markers) {
                const option = element("option", "", String(marker));
                option.value = String(marker);
                select.append(option);
            }
            select.value = String(values[key] ?? definition.default);
            select.addEventListener("change", () => { values[key] = Number(select.value); });
            top.append(select);
        }
        row.append(top, element("span", "orion-ru-setting-description", definition.description));
        settingsPane.append(row);
    }
    settingsPane.append(element("div", "orion-ru-notice", "Изменения сохраняются сразу."), button("← К заданиям", toggleSettings));
}

function ensurePanel() {
    if (panel) return;
    panel = element("div");
    panel.id = "orion-vencord-ru";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Orion — панель заданий");
    panel.setAttribute("lang", "ru");
    const header = element("div", "orion-ru-header");
    const title = element("div", "orion-ru-title", "ϟ Orion");
    title.append(element("span", "orion-ru-version", "RU · 4.11.5-ru.1"));
    header.append(title, button("⚙", toggleSettings, "orion-ru-icon"), button("×", hideDashboard, "orion-ru-icon"));
    (header.children[1] as HTMLButtonElement).title = "Настройки Orion";
    (header.children[2] as HTMLButtonElement).title = "Скрыть панель";
    const stateRow = element("div", "orion-ru-state-row");
    stateElement = element("span", "orion-ru-state");
    stateRow.append(stateElement, element("span", "orion-ru-shortcut", "Shift + . — показать / скрыть"));
    const actions = element("div", "orion-ru-actions");
    startButton = button("Запустить", () => controls?.start(), "primary");
    actions.append(startButton, button("Пауза", () => controls?.pause()), button("Продолжить", () => controls?.resume()), button("Стоп", () => controls?.stop(), "danger"));
    cards = element("div", "orion-ru-cards");
    logElement = element("div", "orion-ru-log");
    logElement.setAttribute("role", "log");
    logElement.append(element("div", "orion-ru-notice", "Открытие панели не запускает задания."));
    const footer = element("div", "orion-ru-footer");
    footer.append(button("Все задания Discord ↗", () => controls?.quests()));
    contentElement = element("div", "orion-ru-content");
    contentElement.append(stateRow, actions, cards, element("div", "orion-ru-log-title", "Журнал событий"), logElement, footer);
    settingsPane = element("div", "orion-ru-settings");
    settingsPane.hidden = true;
    panel.append(header, contentElement, settingsPane);
    document.body.append(panel);
    if (events.length) renderEventLogs();
    render();
}

export function showDashboard() {
    if (!controls) return;
    ensurePanel();
    panel!.hidden = false;
    render();
}

export function hideDashboard() {
    if (panel) panel.hidden = true;
}

export function toggleDashboard() {
    if (!panel || panel.hidden) showDashboard();
    else hideDashboard();
}

function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,textarea,[contenteditable="true"]')) return;
    if (event.shiftKey && event.code === "Period" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        toggleDashboard();
    } else if (event.key === "Escape" && panel && !panel.hidden) hideDashboard();
}

export function initializeDashboard(value: Controls) {
    controls = value;
    unsubscribe = subscribeDashboard(render);
    unsubscribeEvents = subscribeCompanionEvents(appendEvent);
    questStore = getQuestStore();
    onStoreChanged = () => render();
    questStore?.addChangeListener?.(onStoreChanged);
    document.addEventListener("keydown", onKeyDown);
}

export function destroyDashboard() {
    unsubscribe?.();
    unsubscribeEvents?.();
    if (onStoreChanged) questStore?.removeChangeListener?.(onStoreChanged);
    document.removeEventListener("keydown", onKeyDown);
    panel?.remove();
    controls = null;
    panel = cards = logElement = null;
    contentElement = settingsPane = null;
    stateElement = null;
    startButton = null;
    unsubscribe = unsubscribeEvents = onStoreChanged = null;
    questStore = null;
    events.length = 0;
}

export const renderToolbarButton = ErrorBoundary.wrap(() => (
    <HeaderBarIcon
        className="orion-ru-toolbar-button"
        tooltip="Orion — задания"
        onClick={toggleDashboard}
        icon={() => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M13.5 2 4 13h6l-1 9 11-13h-7z" /></svg>}
    />
), { noop: true });
