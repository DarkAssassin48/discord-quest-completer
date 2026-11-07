/* SPDX-License-Identifier: MIT; Copyright (c) 2026 nyxxbit and contributors */
import type { CompanionEvent } from "./companionEvents";

export const statusRu: Record<string, string> = {
    RUNNING: "Выполняется", QUEUE: "В очереди", PAUSED: "На паузе", PENDING: "Доступно",
    COMPLETED: "Выполнено", FAILED: "Ошибка", SKIPPED: "Пропущено", STOPPED: "Остановлено",
};
export const taskTypeRu: Record<string, string> = {
    GAME: "Игра", STREAM: "Трансляция", WATCH_VIDEO: "Видео", ACTIVITY: "Активность", ACHIEVEMENT: "Достижение",
};

const eventRu: Record<string, string> = {
    "engine.started": "Orion запущен", "engine.start_failed": "Не удалось запустить Orion",
    "engine.failed": "Ошибка Orion", "engine.stopped": "Orion остановлен",
    "quest.blocked": "Задание недоступно", "enroll.waiting": "Задание ожидает принятия в Discord",
    "enroll.started": "Принятие задания", "enroll.failed": "Не удалось принять задание",
    "task.started": "Задание запущено", "task.completed": "Задание выполнено", "task.failed": "Ошибка задания",
    "claim.succeeded": "Награда получена", "claim.action_required": "Награду нужно получить вручную",
    "claim.failed": "Не удалось получить награду", "network.retry": "Повтор запроса к Discord",
    "network.failed": "Ошибка подключения к Discord", "heartbeat.failure": "Ошибка проверки прогресса",
    "heartbeat.give_up": "Прогресс не подтверждён: задание остановлено",
    "achievement.fallback": "Выбран другой способ обработки достижения",
    "bypass.started": "Обработка достижения начата", "bypass.succeeded": "Обработка достижения завершена",
    "bypass.failed": "Не удалось обработать достижение", "startup.quest_list_waiting": "Ожидание списка заданий",
    "startup.quest_list_arrived": "Список заданий загружен", "startup.quest_list_timeout": "Время ожидания списка заданий истекло",
    "cycle.started": "Проверка очереди", "cycle.processing": "Обработка очереди",
    "cycle.completed": "Проверка очереди завершена", "cycle.failed": "Ошибка обработки очереди",
    "system.account_changed": "Учётная запись изменилась: состояние сброшено",
    "system.quest_access_suspended": "Discord ограничил доступ к заданиям",
    "system.enrollment_blocked": "Discord запретил принятие заданий",
    "system.quest_list_missing": "Список заданий пока недоступен", "system.run_summary": "Обработка заданий завершена",
    "patcher.presence_restored": "Прежний статус активности восстановлен",
    "patcher.presence_restore_failed": "Не удалось восстановить статус активности",
};

export function eventTextRu(event: CompanionEvent): string {
    const message = eventRu[event.code] ?? "Событие Orion";
    const quest = event.questName ? `: ${event.questName}` : "";
    const http = event.failure?.httpStatus ? ` (HTTP ${event.failure.httpStatus})` : "";
    return message + quest + http;
}

export function progressRu(current: number, max: number, type: string): string {
    const target = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    const cur = Math.min(Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0, target);
    return `${cur.toLocaleString("ru-RU")} / ${target.toLocaleString("ru-RU")}${type === "ACHIEVEMENT" ? "" : " с"}`;
}

export function outcomeTextRu(value: string): string {
    return value
        .replace("All available quests are completed!", "Все доступные задания выполнены!")
        .replace("Nothing left to run.", "Очередь завершена.")
        .replace(/(\d+) quest\(s\) finished/g, "Выполнено: $1")
        .replace(/(\d+) skipped because this client cannot drive them/g, "Не поддерживаются этим клиентом: $1")
        .replace(/(\d+) left out because they pay no Orbs/g, "Без награды Orbs, пропущено: $1")
        .replace(/(\d+) failed/g, "С ошибкой: $1");
}
