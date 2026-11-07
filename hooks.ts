/*
 * OrionQuests, a Vencord userplugin
 * Copyright (c) 2026 nyxxbit
 * SPDX-License-Identifier: MIT
 *
 * Bridge between the settings panel and the running engine.
 *
 * Vencord calls a setting's onChange the moment the user flips it, but
 * settings.ts cannot reach into orion.ts to act on it: orion.ts imports
 * settings.ts, so the reverse import would close a cycle. This module
 * imports nothing, so both sides can depend on it.
 *
 * The engine registers its handlers at start and clears them at stop. A
 * hook left pointing at a torn-down engine is the same class of bug as
 * the module state that used to outlive it.
 */

type Handler<T> = (value: T) => void;

let onAchievementBypass: Handler<boolean> | null = null;

export function setAchievementBypassHook(fn: Handler<boolean> | null): void {
    onAchievementBypass = fn;
}

/** No-op while the engine is down. Settings are read fresh at the next start. */
export function fireAchievementBypassChanged(value: boolean): void {
    onAchievementBypass?.(value);
}

let onOrbQuestsOnly: Handler<boolean> | null = null;

export function setOrbQuestsOnlyHook(fn: Handler<boolean> | null): void {
    onOrbQuestsOnly = fn;
}

/** No-op while the engine is down. The next start reads the setting fresh. */
export function fireOrbQuestsOnlyChanged(value: boolean): void {
    onOrbQuestsOnly?.(value);
}

let onWatchForEnrollments: Handler<boolean> | null = null;

/**
 * Registered by index.tsx rather than the engine: the watcher outlives a run by design, so
 * turning the setting off has to reach it even when nothing is running.
 */
export function setWatchForEnrollmentsHook(fn: Handler<boolean> | null): void {
    onWatchForEnrollments = fn;
}

export function fireWatchForEnrollmentsChanged(value: boolean): void {
    onWatchForEnrollments?.(value);
}

let onAutoClaim: Handler<boolean> | null = null;

export function setAutoClaimHook(fn: Handler<boolean> | null): void {
    onAutoClaim = fn;
}

export function fireAutoClaimChanged(value: boolean): void {
    onAutoClaim?.(value);
}
