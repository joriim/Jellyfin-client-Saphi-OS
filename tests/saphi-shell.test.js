// Unit tests for shell/saphi.js. Run with: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shell', 'saphi.js'), 'utf8');

function makeWindow(opts) {
    opts = opts || {};
    const store = Object.assign({}, opts.storage);
    const listeners = {};
    const dispatched = [];
    const element = {
        tagName: 'DIV',
        dispatchEvent(ev) { dispatched.push(ev); (listeners.keydown || []).forEach((l) => l(ev)); return true; }
    };
    const win = {
        navigator: { userAgent: 'Mozilla/5.0 (Linux; Saphi) PhilipsTV' },
        location: { search: opts.search || '' },
        screen: { width: 1920, height: 1080 },
        devicePixelRatio: 1,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        },
        console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
        Promise,
        JSON,
        Math,
        Date,
        RegExp,
        Object,
        String,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        setTimeout() {},
        setInterval() {},
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        document: {
            activeElement: element,
            body: element,
            createEvent() {
                return { initEvent(type) { this.type = type; } };
            }
        },
        SaphiConfig: opts.config
    };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(SOURCE, win);
    return { win, store, listeners, dispatched, element };
}

function key(keyCode, extra) {
    return Object.assign({
        keyCode, code: '', key: '',
        defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
    }, extra);
}

test('defines NativeShell with the AppHost API jellyfin-web uses', async () => {
    const { win } = makeWindow();
    const host = win.NativeShell.AppHost;
    for (const fn of ['init', 'appName', 'appVersion', 'deviceId', 'deviceName', 'exit',
        'getDefaultLayout', 'getDeviceProfile', 'getSyncProfile', 'screen', 'supports']) {
        assert.strictEqual(typeof host[fn], 'function', fn);
    }
    assert.strictEqual(host.getDefaultLayout(), 'tv');
    assert.strictEqual(host.deviceName(), 'Philips Saphi TV');
    const info = await host.init();
    assert.strictEqual(info.deviceId, host.deviceId());
});

test('device ID is created once and kept in _deviceId2', () => {
    const a = makeWindow();
    const id = a.win.NativeShell.AppHost.deviceId();
    assert.ok(id.length > 10);
    assert.strictEqual(a.store._deviceId2, id);
    const b = makeWindow({ storage: { _deviceId2: 'existing' } });
    assert.strictEqual(b.win.NativeShell.AppHost.deviceId(), 'existing');
});

test('supports() is case-insensitive and honours add/remove', () => {
    const { win } = makeWindow({ config: { features: { add: ['multiserver'], remove: ['exitmenu'] } } });
    const supports = win.NativeShell.AppHost.supports;
    assert.ok(supports('Exit'));
    assert.ok(supports('htmlvideoautoplay'));
    assert.ok(supports('multiserver'));
    assert.ok(!supports('exitmenu'));
    assert.ok(!supports('filedownload'));
    assert.ok(!supports(undefined));
});

test('device profile options merge defaults, server config and localStorage', () => {
    const { win } = makeWindow({
        config: { profile: { supportsHevc: true } },
        storage: { 'saphi.config': JSON.stringify({ profile: { enableHls: false } }) }
    });
    let seen;
    const profile = win.NativeShell.AppHost.getDeviceProfile((o) => { seen = o; return { ok: 1 }; });
    assert.deepStrictEqual(profile, { ok: 1 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(seen)), {
        enableMkvProgressive: false, enableSsaRender: true, supportsHevc: true, enableHls: false
    });
});

test('bad JSON in localStorage is ignored', () => {
    const { win } = makeWindow({ storage: { 'saphi.config': '{oops' } });
    assert.strictEqual(win.SaphiShell.config.debug, false);
});

test('?saphi-debug=1 turns debug on and remembers it; ?saphi-reset=1 clears', () => {
    const a = makeWindow({ search: '?saphi-debug=1' });
    assert.strictEqual(a.win.SaphiShell.config.debug, true);
    assert.strictEqual(JSON.parse(a.store['saphi.config']).debug, true);
    const b = makeWindow({ storage: a.store });
    assert.strictEqual(b.win.SaphiShell.config.debug, true);
    const c = makeWindow({ storage: a.store, search: '?saphi-reset=1' });
    assert.strictEqual(c.win.SaphiShell.config.debug, false);
});

test('screen() uses config, else window.screen times devicePixelRatio', () => {
    const a = makeWindow();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a.win.NativeShell.AppHost.screen())), { width: 1920, height: 1080 });
    const b = makeWindow({ config: { screenWidth: 3840, screenHeight: 2160 } });
    assert.strictEqual(b.win.NativeShell.AppHost.screen().width, 3840);
});

test('mapped keys are re-sent in the form jellyfin-web understands', () => {
    const { win, listeners, dispatched } = makeWindow({ config: { keyMap: { '403': 'MediaStop' } } });
    const onKey = listeners.keydown[0];

    const red = key(403);
    onKey(red);
    assert.ok(red.defaultPrevented && red.stopped);
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].keyCode, 413);
    assert.strictEqual(dispatched[0].saphiTranslated, true);

    // Keys jellyfin-web already knows pass through untouched.
    const back = key(461);
    onKey(back);
    assert.ok(!back.defaultPrevented);
    assert.strictEqual(dispatched.length, 1);

    // Pause with the right event.code is already fine; without it, it is fixed up.
    assert.strictEqual(win.SaphiShell.translateKey(key(19, { code: 'Pause' })), null);
    assert.strictEqual(win.SaphiShell.translateKey(key(19)), 'Pause');
});

test('Backspace becomes Back only when enabled and no text field has focus', () => {
    const off = makeWindow();
    assert.strictEqual(off.win.SaphiShell.translateKey(key(8)), null);

    const on = makeWindow({ config: { backspaceIsBack: true } });
    assert.strictEqual(on.win.SaphiShell.translateKey(key(8)), 'Back');
    on.win.document.activeElement = { tagName: 'INPUT', type: 'text' };
    assert.strictEqual(on.win.SaphiShell.translateKey(key(8)), null);
    on.win.document.activeElement = { tagName: 'INPUT', type: 'checkbox' };
    assert.strictEqual(on.win.SaphiShell.translateKey(key(8)), 'Back');
});

test('console output is captured in the log buffer', () => {
    const { win } = makeWindow();
    win.console.warn('hello', { a: 1 });
    const last = win.SaphiShell.logs().pop();
    assert.strictEqual(last.level, 'warn');
    assert.strictEqual(last.msg, 'hello {"a":1}');
});
