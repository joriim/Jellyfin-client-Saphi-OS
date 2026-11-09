// End-to-end test: the Saphi client in Chromium against tools/fakejellyfin.py,
// driven only with remote-control keys. Run with: npm run e2e
// Needs Playwright with Chromium, and ffmpeg (for the fake server's clips).
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = 'http://127.0.0.1:' + PORT;
let server;
let browser;
let page;
const errors = [];

async function state() {
    return (await fetch(BASE + '/_test/state')).json();
}

async function key(name, times) {
    for (let i = 0; i < (times || 1); i++) {
        await page.keyboard.press(name);
        await page.waitForTimeout(60);
    }
}

/** Back closes the player; the first press may only hide the controls. */
async function leavePlayer() {
    for (let i = 0; i < 3 && (await screen()) === 'screen-player'; i++) await key('Escape');
    assert.notStrictEqual(await screen(), 'screen-player');
}

/** Presses a key until the focused element's text matches. */
async function keyUntil(name, re, max) {
    for (let i = 0; i < (max || 8); i++) {
        if (re.test((await focusedText()) || '')) return;
        await key(name);
    }
    assert.match(await focusedText(), re);
}

/** Waits for a selector inside the current (top) screen; returns its text. */
async function inScreen(sel) {
    return waitFor(() => page.evaluate((sel) => {
        const e = JF.router.current() && JF.router.current().el.querySelector(sel);
        return e ? e.textContent || ' ' : null;
    }, sel));
}

async function screen() {
    return page.evaluate(() => JF.router.current().el.className.replace('screen ', ''));
}

async function focusedText() {
    return page.evaluate(() => {
        const f = JF.router.current().el.querySelector('.focused');
        return f ? f.textContent : null;
    });
}

async function waitFor(fn, ms) {
    const end = Date.now() + (ms || 8000);
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting for ' + fn);
        await new Promise((r) => setTimeout(r, 100));
    }
}

before(async () => {
    server = spawn('python3', [path.join(__dirname, '..', '..', 'tools', 'fakejellyfin.py'), '--port', String(PORT), '--host', '127.0.0.1'],
        { env: Object.assign({}, process.env, { SAPHI_QUIET: '1' }), stdio: 'ignore' });
    await waitFor(() => fetch(BASE + '/System/Info/Public').then((r) => r.ok, () => false), 10000);
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/web/saphi/');
});

after(async () => {
    if (browser) await browser.close();
    if (server) server.kill();
});

test('connect: the server it is served from is suggested', async () => {
    assert.strictEqual(await screen(), 'screen-connect');
    assert.strictEqual(await page.inputValue('.field'), BASE);
    assert.strictEqual(await focusedText(), 'Connect');
    await key('Enter');
    await page.waitForSelector('.qc-code');
    assert.strictEqual(await screen(), 'screen-login');
});

test('login: Quick Connect signs in once the code is approved', async () => {
    await page.evaluate(() => { JF.app.quickConnectInterval = 200; });
    // Restart polling at the faster interval.
    await key('Escape');
    assert.strictEqual(await screen(), 'screen-connect');
    await key('Enter');
    await page.waitForSelector('.qc-code');
    const code = await page.textContent('.qc-code');
    const s = await state();
    assert.ok(Object.values(s.qc).some((q) => q.code === code));
    await fetch(BASE + '/_test/approve');
    await page.waitForSelector('.screen-home .row', { timeout: 8000 });
    // Sign out again to test the password route.
    await page.evaluate(() => JF.app.logout());
    await page.waitForSelector('.screen-login');
});

test('login: the user name is remembered; wrong password shows an error', async () => {
    assert.strictEqual(await page.inputValue('.field[type=text]'), 'demo');
    assert.strictEqual(await page.evaluate(() => JF.router.current().el.querySelector('.focused').type), 'password');
    await key('Enter'); // opens the field (the TV shows its keyboard)
    await page.keyboard.type('nope');
    await key('Enter'); // submit
    await page.waitForSelector('.message.error');
    assert.match(await page.textContent('.message.error'), /Wrong user name or password/);
    await key('Enter');
    await page.fill('input[type=password]', '');
    await page.keyboard.type('demo');
    await key('Enter');
    await page.waitForSelector('.screen-home .row');
    const rows = await page.$$eval('.row-title', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(rows, ['My Media', 'Latest Movies', 'Latest Shows']);
});

test('home → library grid → details', async () => {
    assert.strictEqual(await focusedText(), 'Movies');
    await key('Enter');
    await page.waitForSelector('.screen-library .card');
    assert.strictEqual(await page.textContent('.header-sub'), '2 items');
    assert.match(await focusedText(), /Big Test Movie/);
    await key('ArrowRight');
    assert.match(await focusedText(), /The H\.264 Story/);
    await key('ArrowLeft');
    await key('Enter');
    await inScreen('.details-title');
    assert.strictEqual(await inScreen('.details-title'), 'Big Test Movie');
    assert.strictEqual(await focusedText(), 'Play');
});

test('direct play: reports start, progress and stop, then offers resume', async () => {
    await key('Enter');
    await waitFor(() => page.evaluate(() => {
        const p = JF.router.current();
        return p.debugState && p.debugState().started;
    }));
    const st = await page.evaluate(() => JF.router.current().debugState());
    assert.strictEqual(st.method, 'DirectPlay');
    assert.match(st.src, /\/Videos\/[0-9a-f]+\/stream\.webm\?static=true/);
    await page.waitForTimeout(2500);
    await key('Enter'); // pause
    await waitFor(async () => (await state()).reports.some((r) => r[0] === 'Progress' && r[1].IsPaused));
    await key('Escape');
    await waitFor(async () => (await state()).reports.some((r) => r[0] === 'Stopped'));
    const s = await state();
    const kinds = s.reports.map((r) => r[0]);
    assert.strictEqual(kinds[0], 'Playing');
    const stopped = s.reports.find((r) => r[0] === 'Stopped')[1];
    assert.ok(stopped.PositionTicks > 15000000, 'position reported: ' + stopped.PositionTicks);
    assert.strictEqual(stopped.PlayMethod, 'DirectPlay');
    assert.ok(stopped.PlaySessionId);
    // The profile sent to the server says what this browser can play.
    const profile = s.playback[0].DeviceProfile;
    assert.ok(profile.DirectPlayProfiles.some((p) => p.Container === 'webm'));
    assert.strictEqual(s.playback[0].MaxStreamingBitrate, 20000000);
    // Back on the details screen, Resume is offered.
    await inScreen('.details-title');
    await waitFor(async () => /^Resume from 0:0\d$/.test(await focusedText()));
});

test('transcode: with H.264 switched off in settings, the server transcodes', async () => {
    await page.evaluate(() => { JF.app.settings.caps = { h264: false }; JF.app.saveSettings(); });
    await key('Escape'); // details → library
    assert.strictEqual(await screen(), 'screen-library');
    await key('ArrowRight');
    await key('Enter');
    await inScreen('.details-title');
    await waitFor(async () => (await focusedText()) === 'Play');
    await key('Enter');
    await waitFor(() => page.evaluate(() => {
        const p = JF.router.current();
        return p.debugState && p.debugState().started;
    }));
    const st = await page.evaluate(() => JF.router.current().debugState());
    assert.strictEqual(st.method, 'Transcode');
    assert.match(st.src, /transcode\.webm/);
    await leavePlayer();
    await waitFor(async () => (await state()).reports.some((r) => r[0] === 'StopEncoding'));
    await inScreen('.details-title');
    const last = (await state()).playback.pop().DeviceProfile;
    assert.ok(!last.DirectPlayProfiles.some((p) => /h264/.test(p.VideoCodec || '')));
    await page.evaluate(() => { JF.app.settings.caps = {}; JF.app.saveSettings(); });
});

test('series → season → episode; next episode plays automatically', async () => {
    await key('Escape');
    await key('Escape');
    assert.strictEqual(await screen(), 'screen-home');
    // Continue Watching now comes first, holding the movie we stopped.
    const rows = await page.$$eval('.screen-home .row-title', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(rows, ['Continue Watching', 'My Media', 'Latest Movies', 'Latest Shows']);
    await keyUntil('ArrowDown', /Test Series/);
    await key('Enter');
    await inScreen('.details-title');
    await waitFor(() => page.$('.row .card'));
    await key('ArrowDown'); // Seasons row
    assert.match(await focusedText(), /Season 1/);
    await key('Enter');
    await page.waitForSelector('.episode');
    assert.match(await focusedText(), /1\. Episode 1/);
    await key('ArrowDown', 2);
    assert.match(await focusedText(), /3\. Episode 3/);
    await key('Enter');
    await inScreen('.details-title');
    assert.strictEqual(await inScreen('.details-title'), 'Episode 3');
    await waitFor(async () => (await focusedText()) === 'Play');
    await key('Enter');
    await waitFor(() => page.evaluate(() => {
        const p = JF.router.current();
        return p.debugState && p.debugState().started;
    }));
    await key('ArrowRight'); // +30 s: clamps to the last two seconds
    await waitFor(() => page.evaluate(() => {
        const p = JF.router.current();
        return p.player && p.player.Name === 'Episode 1' && p.player.ParentIndexNumber === 2 && p.debugState().started;
    }), 15000);
    const s = await state();
    const ep3Stop = s.reports.filter((r) => r[0] === 'Stopped').pop();
    assert.ok(ep3Stop);
    await leavePlayer();
    assert.strictEqual(await screen(), 'screen-details');
});

test('Back on Home returns to the top row, then asks before exiting; no page errors', async () => {
    await key('Escape', 3);
    assert.strictEqual(await screen(), 'screen-home');
    assert.match(await focusedText(), /Test Series/);
    await key('Escape'); // jumps to the first content row
    assert.strictEqual(await page.evaluate(() => JF.router.current().focus.rowIndex), 1);
    await key('Escape');
    await waitFor(async () => /Press Back again to exit/.test(await page.textContent('#toast')));
    assert.strictEqual(await screen(), 'screen-home');
    assert.deepStrictEqual(errors, []);
});

test('pointer: a click on Connect works (TV browsers with a remote-driven pointer)', async () => {
    // A fresh page with no session, driven only by the mouse.
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const perrors = [];
    p.on('pageerror', (e) => perrors.push(e.message));
    await p.goto(BASE + '/web/saphi/?debug=1');
    await p.waitForSelector('.screen-connect .btn.primary');
    assert.notStrictEqual(await p.evaluate(() => getComputedStyle(document.body).cursor), 'none');
    // Hover moves the focus highlight; click selects.
    await p.hover('.screen-connect .field');
    await p.hover('.screen-connect .btn.primary');
    assert.match(await p.getAttribute('.screen-connect .btn.primary', 'class'), /\bfocused\b/);
    await p.click('.screen-connect .btn.primary');
    await p.waitForSelector('.screen-login .qc-code');
    assert.strictEqual(await p.evaluate(() => JF.app.settings.debug), true);
    assert.deepStrictEqual(perrors, []);
    await p.close();
});
