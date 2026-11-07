/*
 * OrionQuests, a Vencord userplugin
 * Copyright (c) 2026 nyxxbit
 * SPDX-License-Identifier: MIT
 *
 * Plugin settings, exposed in Vencord's plugin settings UI.
 * Persisted via Vencord's DataStore.
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { fireAchievementBypassChanged, fireAutoClaimChanged, fireOrbQuestsOnlyChanged, fireWatchForEnrollmentsChanged } from "./hooks";

export const settings = definePluginSettings({
    autoStart: {
        type: OptionType.BOOLEAN,
        displayName: "Автозапуск",
        description: "Запускать Orion вместе с Discord. Если выключено, запуск выполняется кнопкой в панели Orion.",
        default: false,
    },

    autoEnroll: {
        type: OptionType.BOOLEAN,
        displayName: "Автопринятие заданий",
        description: "Принимать доступные задания автоматически. Если выключено, обрабатываются только задания, которые вы приняли в Discord вручную.",
        default: true,
    },

    orbQuestsOnly: {
        type: OptionType.BOOLEAN,
        displayName: "Только задания за Orbs",
        description: "Обрабатывать только задания, среди наград которых есть Orbs. Прочие задания не принимаются и не запускаются. Уже запущенные задания завершаются.",
        default: false,
        onChange: (value: boolean) => fireOrbQuestsOnlyChanged(value),
    },

    watchForEnrollments: {
        type: OptionType.BOOLEAN,
        displayName: "Следить за принятыми заданиями",
        description: "Запускать очередь после принятия задания в Discord. Если одновременно включено автопринятие, очередь может принять и другие задания. Стоп выключает слежение до следующего запуска. Автоматизация может привести к ограничениям Discord.",
        default: false,
        onChange: (value: boolean) => fireWatchForEnrollmentsChanged(value),
    },

    achievementBypass: {
        type: OptionType.BOOLEAN,
        displayName: "Обработка достижений активности",
        description: "Разрешить Orion авторизовать приложение задания через OAuth и сообщать прогресс серверу активности. Это автоматизация действий учётной записи: Discord может ограничить задания или аккаунт. По умолчанию выключено. Включайте только осознанно.",
        default: false,
        onChange: (value: boolean) => fireAchievementBypassChanged(value),
    },

    tryToClaimReward: {
        type: OptionType.BOOLEAN,
        displayName: "Автоматически забирать награды",
        description: "Забирать все выполненные награды, включая задания прошлых запусков. Временные ошибки повторяются до четырёх попыток. Работает и после завершения очереди. Капча и подтверждения открываются в Discord вручную. Стоп приостанавливает автосбор до следующего запуска.",
        default: false,
        onChange: (value: boolean) => fireAutoClaimChanged(value),
    },

    hideActivity: {
        type: OptionType.BOOLEAN,
        displayName: "Скрывать игровую активность",
        description: "На время обработки игровых заданий выключать показ текущей игры и восстанавливать прежнюю настройку после остановки. Изменение применяется и к текущему заданию.",
        default: false,
    },

    playSessionTail: {
        type: OptionType.SLIDER,
        displayName: "Продолжительность активности после завершения",
        description: "Сколько минут сохранять игровую активность после завершения задания. Ноль — завершать сразу. Стоп прекращает её в любом случае. Эта настройка не гарантирует защиты от обнаружения автоматизации.",
        markers: [0, 1, 2, 3, 5, 8],
        stickToMarkers: true,
        default: 2,
    },

    gameConcurrency: {
        type: OptionType.SLIDER,
        displayName: "Игровые задания одновременно",
        description: "Число параллельных игровых заданий. Рекомендуемое исходным проектом значение — 1. Изменение применяется к следующей группе заданий.",
        markers: [1, 2, 3],
        stickToMarkers: true,
        default: 1,
    },

    videoConcurrency: {
        type: OptionType.SLIDER,
        displayName: "Видеозадания одновременно",
        description: "Число параллельных видеозаданий. Большие значения увеличивают число запросов. Применяется к следующей группе заданий.",
        markers: [1, 2, 3, 4],
        stickToMarkers: true,
        default: 2,
    },

    playSound: {
        type: OptionType.BOOLEAN,
        displayName: "Звуки завершения",
        description: "Проигрывать звук после завершения задания и всей очереди.",
        default: false,
    },

    verboseLogging: {
        type: OptionType.BOOLEAN,
        displayName: "Подробный журнал",
        description: "Показывать диагностические сообщения Orion в консоли. Удобно при изменениях интерфейса Discord.",
        default: false,
    },
});
