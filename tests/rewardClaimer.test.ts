import assert from "node:assert/strict";
import test from "node:test";

import { canClaimReward, RewardClaimer, type RewardClaimState, type RewardQuest } from "../rewardClaimer";

const completed = (id: string): RewardQuest => ({ id, userStatus: { completedAt: "2026-11-07T00:00:00Z" } });

function harness(post: (id: string) => Promise<any> = async () => ({ body: { claimed_at: "confirmed" } })) {
    const context = { account: "one" as string | null, enabled: true, quests: [completed("a"), completed("b")], calls: [] as string[], events: [] as RewardClaimState[] };
    const claimer = new RewardClaimer({
        accountId: () => context.account, enabled: () => context.enabled, quests: () => context.quests,
        post: async id => { context.calls.push(id); return post(id); },
        changed: state => context.events.push(state),
    });
    return { context, claimer };
}

test("claims old completed rewards without a running task engine, exactly once", async () => {
    const { context, claimer } = harness();
    await claimer.tick(0);
    await claimer.tick(2000);
    await claimer.tick(4000);
    assert.deepEqual(context.calls, ["a", "b"]);
    assert.deepEqual(claimer.read().map(state => state.status), ["CLAIMED", "CLAIMED"]);
});

test("only completed, unclaimed, unexpired rewards qualify; task expiry is irrelevant", () => {
    assert.equal(canClaimReward({ id: "pending" }), false);
    assert.equal(canClaimReward({ ...completed("claimed"), userStatus: { completedAt: "yes", claimedAt: "yes" } }), false);
    assert.equal(canClaimReward({ ...completed("expired"), config: { rewardsConfig: { expiresAt: "2020-01-01" } } }), false);
    assert.equal(canClaimReward(completed("valid")), true);
});

test("disabled autoclaim makes no requests; a manual batch still works and deduplicates", async () => {
    const { context, claimer } = harness();
    context.enabled = false;
    await claimer.tick(0);
    assert.deepEqual(context.calls, []);
    assert.equal(claimer.request(["a", "a", "missing"], 0), 1);
    await claimer.tick(0);
    await claimer.tick(2000);
    assert.deepEqual(context.calls, ["a"]);
});

test("parallel ticks cannot duplicate an in-flight claim", async () => {
    let resolve!: (value: any) => void;
    const { context, claimer } = harness(() => new Promise(done => { resolve = done; }));
    const pending = claimer.tick(0);
    await claimer.tick(2000);
    assert.deepEqual(context.calls, ["a"]);
    resolve({ body: { claimed_at: "yes" } });
    await pending;
});

test("429 retry_after pauses the whole queue, then retries without duplicate success", async () => {
    let fail = true;
    const { context, claimer } = harness(async () => {
        if (fail) { fail = false; throw { status: 429, body: { retry_after: 12 } }; }
        return { body: { claimed_at: "yes" } };
    });
    await claimer.tick(0);
    await claimer.tick(11000);
    assert.deepEqual(context.calls, ["a"]);
    await claimer.tick(12000);
    assert.deepEqual(context.calls, ["a", "a"]);
    assert.equal(claimer.read()[0].status, "CLAIMED");
});

test("captcha and forbidden responses require user action and are never automatically retried", async () => {
    for (const error of [{ status: 400, body: { captcha_key: ["required"] } }, { status: 403 }]) {
        const { context, claimer } = harness(async () => { throw error; });
        context.quests = [completed("a")];
        await claimer.tick(0);
        await claimer.tick(100000);
        assert.deepEqual(context.calls, ["a"]);
        assert.equal(claimer.read()[0].status, "ACTION_REQUIRED");
        assert.equal(claimer.request(["a"], 0), 0);
    }
});

test("temporary errors have a finite retry budget; unrelated rewards still proceed", async () => {
    const { context, claimer } = harness(async id => {
        if (id === "a") throw { status: 503 };
        return { body: { claimed_at: "yes" } };
    });
    for (const now of [0, 2000, 5000, 15000, 35000, 100000]) await claimer.tick(now);
    assert.equal(context.calls.filter(id => id === "a").length, 4);
    assert.equal(context.calls.filter(id => id === "b").length, 1);
    assert.equal(claimer.read().find(state => state.id === "a")?.status, "FAILED");
});

test("an unconfirmed 2xx is retried rather than reported as a claimed reward", async () => {
    const { context, claimer } = harness(async () => ({ body: {} }));
    context.quests = [completed("a")];
    for (const now of [0, 5000, 15000, 30000, 60000]) await claimer.tick(now);
    assert.equal(context.calls.length, 4);
    assert.equal(claimer.read()[0].status, "FAILED");
    assert.equal(context.events.some(state => state.status === "CLAIMED"), false);
});

test("switching account discards late responses and old manual intents", async () => {
    let resolve!: (value: any) => void;
    const { context, claimer } = harness(() => new Promise(done => { resolve = done; }));
    const pending = claimer.tick(0);
    context.account = "two";
    context.quests = [completed("new-account")];
    assert.deepEqual(claimer.read(), []);
    resolve({ body: { claimed_at: "old-account" } });
    await pending;
    assert.deepEqual(claimer.read(), []);
    assert.equal(context.events.some(state => state.status === "CLAIMED"), false);
});

test("stop, unknown account and plugin teardown prevent additional requests", async () => {
    const { context, claimer } = harness();
    claimer.suspend();
    await claimer.tick(0);
    assert.equal(context.calls.length, 0);
    claimer.resume();
    context.account = null;
    await claimer.tick(2000);
    assert.equal(context.calls.length, 0);
    context.account = "one";
    claimer.destroy();
    await claimer.tick(4000);
    assert.equal(context.calls.length, 0);
});

test("an unknown identity during the request cannot leave a permanently busy card", async () => {
    let resolve!: (value: any) => void;
    const { context, claimer } = harness(() => new Promise(done => { resolve = done; }));
    const pending = claimer.tick(0);
    context.account = null;
    resolve({ body: { claimed_at: "yes" } });
    await pending;
    assert.deepEqual(claimer.read(), []);
    context.account = "one";
    assert.equal(claimer.read()[0].status, "RETRY");
});

test("a manual batch can resume a pending retry after automatic collection was disabled", async () => {
    let fail = true;
    const { context, claimer } = harness(async () => {
        if (fail) { fail = false; throw { status: 503 }; }
        return { body: { claimed_at: "yes" } };
    });
    context.quests = [completed("a")];
    await claimer.tick(0);
    context.enabled = false;
    claimer.suspend();
    assert.equal(claimer.request(["a", "a"], 1000), 1);
    await claimer.tick(5000);
    assert.equal(claimer.read()[0].status, "CLAIMED");
    assert.equal(context.calls.length, 2);
});

test("turning autoclaim off from its state observer prevents the imminent POST", async () => {
    let enabled = true;
    let calls = 0;
    const claimer = new RewardClaimer({
        accountId: () => "one", enabled: () => enabled, quests: () => [completed("a")],
        post: async () => { calls++; return {}; }, changed: () => { enabled = false; },
    });
    await claimer.tick(0);
    assert.equal(calls, 0);
    assert.equal(claimer.read()[0].status, "QUEUED");
});
