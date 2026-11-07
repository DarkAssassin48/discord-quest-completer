import assert from "node:assert/strict";
import test from "node:test";

import type { CompanionEvent } from "../companionEvents";
import { eventTextRu, outcomeTextRu, progressRu } from "../uiRu";

test("dashboard event text never displays raw messages or credential-bearing diagnostic fields", () => {
    const event = {
        code: "network.failed", questName: "Пример", message: "Bearer secret-token",
        failure: { httpStatus: 403, message: "private-url?token=secret" }
    } as unknown as CompanionEvent;
    assert.equal(eventTextRu(event), "Ошибка подключения к Discord: Пример (HTTP 403)");
    assert.equal(eventTextRu({ ...event, code: "future.unknown" } as unknown as CompanionEvent), "Событие Orion: Пример (HTTP 403)");
});

test("malformed progress values cannot overflow a card or show NaN", () => {
    assert.equal(progressRu(115, 100, "GAME"), "100 / 100 с");
    assert.equal(progressRu(-5, 7, "ACHIEVEMENT"), "0 / 7");
    assert.equal(progressRu(Number.NaN, Infinity, "GAME"), "0 / 0 с");
});

test("display translation retains the engine summary counts", () => {
    assert.equal(outcomeTextRu("Nothing left to run. 2 quest(s) finished, 1 failed."), "Очередь завершена. Выполнено: 2, С ошибкой: 1.");
});
