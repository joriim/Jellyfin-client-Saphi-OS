// Unit tests for the Saphi client modules (app/js). Run with: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..', 'app', 'js');
const FILES = ['core.js', 'platform.js', 'api.js', 'profile.js', 'ui.js', 'player.js'];

/** Loads the app modules into a sandbox with a minimal browser stub. */
function load(opts) {
    opts = opts || {};
    const store = {};
    const win = {
        navigator: { userAgent: opts.ua || 'Mozilla/5.0 (Linux) PhilipsTV/Saphi' },
        location: { search: '', protocol: 'http:', host: 'tv', pathname: '/' },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        },
        document: {
            createElement: (tag) => ({ tagName: tag.toUpperCase(), className: '', style: {}, children: [],
                appendChild(c) { this.children.push(c); return c; }, setAttribute() {} }),
            body: { appendChild() {} }
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
        history: { length: 1 }
    };
    if (!opts.noPromise) win.Promise = Promise;
    win.window = win;
    vm.createContext(win);
    for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), win, { filename: f });
    return { JF: win.JF, win, store };
}

// ------------------------------------------------------------------ ES5

test('app and shell sources use ES5 syntax only', () => {
    const files = fs.readdirSync(APP).map((f) => path.join(APP, f))
        .concat([path.join(__dirname, '..', 'shell', 'saphi.js')]);
    const banned = [
        [/=>/, 'arrow function'], [/\blet\s/, 'let'], [/\bconst\s/, 'const'], [/`/, 'template literal'],
        [/\bclass\s+[A-Z]/, 'class'], [/\.\.\.[A-Za-z_]/, 'spread'], [/\basync\s+function|\bawait\s/, 'async/await'],
        [/\.(includes|startsWith|endsWith|padStart|find|findIndex)\(/, 'ES2015+ method'], [/\?\.|\?\?/, 'optional chaining']
    ];
    for (const file of files) {
        // Drop comments and string literals before checking.
        const code = fs.readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '')
            .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');
        for (const [re, name] of banned) {
            assert.ok(!re.test(code), path.basename(file) + ' uses ' + name + ': ' + (code.match(re) || [])[0]);
        }
        // And it must parse as a script.
        new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    }
});

// ------------------------------------------------------------------ core

test('Promise fallback resolves, chains, rejects and joins', async () => {
    const { JF } = load({ noPromise: true });
    const P = JF.Promise;
    assert.notStrictEqual(P, Promise);
    const v = await new Promise((res) => P.resolve(1).then((x) => x + 1).then((x) => { res(x); }));
    assert.strictEqual(v, 2);
    const e = await new Promise((res) => P.reject(new Error('no'))['catch']((err) => res(err.message)));
    assert.strictEqual(e, 'no');
    const thrown = await new Promise((res) => P.resolve().then(() => { throw new Error('t'); }).then(null, (err) => res(err.message)));
    assert.strictEqual(thrown, 't');
    const all = await new Promise((res) => P.all([1, P.resolve(2), new P((r) => setTimeout(() => r(3), 5))]).then(res));
    assert.deepStrictEqual(Array.from(all), [1, 2, 3]);
    const nested = await new Promise((res) => P.resolve(P.resolve(5)).then(res));
    assert.strictEqual(nested, 5);
});

test('formatting helpers', () => {
    const { JF } = load();
    assert.strictEqual(JF.util.formatTime(65), '1:05');
    assert.strictEqual(JF.util.formatTime(3725), '1:02:05');
    assert.strictEqual(JF.util.formatRuntime(102 * 60 * 1e7), '1 h 42 min');
    assert.strictEqual(JF.util.query({ a: 1, b: null, c: 'x y' }), 'a=1&c=x%20y');
});

// ------------------------------------------------------------------ platform

test('remote keys map to actions; text fields keep typing keys', () => {
    const { JF } = load();
    const k = (keyCode, key, active) => JF.platform.keyAction({ keyCode, key }, active || null);
    assert.strictEqual(k(37), 'left');
    assert.strictEqual(k(461), 'back');
    assert.strictEqual(k(0, 'GoBack'), 'back');
    assert.strictEqual(k(415), 'play');
    assert.strictEqual(k(406), 'blue');
    assert.strictEqual(k(999), null);
    const field = { tagName: 'INPUT', type: 'text' };
    assert.strictEqual(k(8, 'Backspace', field), null);
    assert.strictEqual(k(37, 'ArrowLeft', field), null);
    assert.strictEqual(k(40, 'ArrowDown', field), 'down');
    assert.strictEqual(k(13, 'Enter', field), 'submit');
    assert.strictEqual(k(73, 'i', field), null, 'typing i is not the info key');
    assert.strictEqual(k(32, ' ', field), null);
    assert.strictEqual(k(461, '', field), 'back');
    assert.strictEqual(k(73, 'i'), 'info');
    assert.strictEqual(k(8, 'Backspace', { tagName: 'INPUT', type: 'checkbox' }), 'back');
    JF.platform.setKeyOverrides({ '1001': 'back', '37': 'right' });
    assert.strictEqual(k(1001), 'back');
    assert.strictEqual(k(37), 'right');
});

test('device ID is stable and differs per user', () => {
    const { JF } = load();
    const a = JF.platform.deviceId();
    assert.strictEqual(JF.platform.deviceId(), a);
    const u1 = JF.platform.deviceId('user1');
    const u2 = JF.platform.deviceId('user2');
    assert.ok(u1.indexOf(a) === 0 && u1 !== u2);
    assert.strictEqual(JF.platform.deviceId('user1'), u1);
    assert.ok(JF.platform.isSaphi('Mozilla/5.0 (Linux; Saphi) PhilipsTV'));
    assert.ok(!JF.platform.isSaphi('Mozilla/5.0 (X11; Linux) Chrome/120'));
});

// ------------------------------------------------------------------ api

function fakeXhr(routes, log) {
    return function () {
        const x = {
            headers: {},
            open(method, url) { this.method = method; this.url = url; },
            setRequestHeader(k, v) { this.headers[k] = v; },
            send(body) {
                log.push({ method: this.method, url: this.url, headers: this.headers, body });
                const path = this.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
                const host = (this.url.match(/^https?:\/\/[^/]+/) || [''])[0];
                const r = routes(this.method, path, host, body);
                setTimeout(() => {
                    this.readyState = 4;
                    this.status = r ? r[0] : 0;
                    this.responseText = r && r[1] !== undefined ? JSON.stringify(r[1]) : '';
                    this.onreadystatechange();
                }, 0);
            }
        };
        return x;
    };
}

test('address candidates for what the user types', () => {
    const { JF } = load();
    const c = (s) => Array.from(JF.Api.addressCandidates(s));
    assert.deepStrictEqual(c('192.168.1.10'), ['http://192.168.1.10:8096', 'https://192.168.1.10:8920', 'http://192.168.1.10', 'https://192.168.1.10']);
    assert.deepStrictEqual(c('https://jf.example.com/'), ['https://jf.example.com', 'https://jf.example.com:8920']);
    assert.deepStrictEqual(c('nas:8096'), ['http://nas:8096', 'https://nas:8096']);
    assert.deepStrictEqual(c('http://nas:9000/jellyfin'), ['http://nas:9000/jellyfin']);
    assert.deepStrictEqual(c('  '), []);
});

test('findServer tries candidates until one answers like Jellyfin', async () => {
    const { JF } = load();
    const log = [];
    const xhr = fakeXhr((m, path, host) => {
        if (host === 'http://nas' && path === '/System/Info/Public') return [200, { Id: 'abc', ServerName: 'NAS', ProductName: 'Jellyfin Server' }];
        if (host === 'https://nas:8920') return [200, { not: 'jellyfin' }];
        return null;
    }, log);
    const found = await JF.Api.findServer('nas', { deviceId: 'd', xhr });
    assert.strictEqual(found.address, 'http://nas');
    assert.strictEqual(found.info.ServerName, 'NAS');
    assert.strictEqual(log.length, 3);
    await assert.rejects(JF.Api.findServer('nowhere', { deviceId: 'd', xhr: fakeXhr(() => null, []) }), /No Jellyfin server/);
});

test('requests carry the MediaBrowser auth header and parse errors', async () => {
    const { JF } = load();
    const log = [];
    const api = new JF.Api({
        server: 'http://jf:8096/', deviceId: 'dev"1', deviceName: 'TV',
        xhr: fakeXhr((m, path) => {
            if (path === '/Users/AuthenticateByName') return [200, { AccessToken: 'tok', User: { Id: 'u1', Name: 'demo' } }];
            if (path === '/UserViews') return [200, { Items: [{ Id: 'v' }] }];
            return [401, { error: 'no' }];
        }, log)
    });
    await api.authenticateByName('demo', 'pw');
    assert.strictEqual(api.token, 'tok');
    assert.strictEqual(api.userId, 'u1');
    assert.deepStrictEqual(JSON.parse(log[0].body), { Username: 'demo', Pw: 'pw' });
    assert.match(log[0].headers.Authorization, /^MediaBrowser Client="Jellyfin Saphi", Device="TV", DeviceId="dev'1", Version="[\d.]+"$/);
    const views = await api.getViews();
    assert.strictEqual(views[0].Id, 'v');
    assert.match(log[1].url, /^http:\/\/jf:8096\/UserViews\?userId=u1$/);
    assert.match(log[1].headers.Authorization, /Token="tok"$/);
    await assert.rejects(api.getItem('x'), (e) => e.status === 401);
});

test('image URLs fall back to series and parent images', () => {
    const { JF } = load();
    const api = new JF.Api({ server: 'http://jf', deviceId: 'd' });
    assert.strictEqual(api.imageUrl({ Id: 'a', ImageTags: { Primary: 't' } }, 'Primary', { width: 220 }),
        'http://jf/Items/a/Images/Primary?fillWidth=220&quality=80&tag=t');
    assert.match(api.imageUrl({ Id: 'e', SeriesId: 's', SeriesPrimaryImageTag: 'st' }, 'Primary'), /Items\/s\/Images\/Primary\?.*tag=st/);
    assert.match(api.imageUrl({ Id: 'e', ParentBackdropItemId: 'p', ParentBackdropImageTags: ['b'] }, 'Backdrop'), /Items\/p\/Images\/Backdrop\/0/);
    assert.strictEqual(api.imageUrl({ Id: 'x' }, 'Primary'), null);
});

// ------------------------------------------------------------------ profile

function caps(list) {
    return { canPlayType: (t) => (list.some((x) => t.indexOf(x) !== -1) ? 'probably' : '') };
}

test('device profile follows what the browser can play', () => {
    const { JF } = load();
    const tv = JF.profile.detect(caps(['avc1', 'mp4a', 'ac-3', 'mpegurl', 'mp2t', 'hvc1']));
    assert.ok(tv.h264 && tv.hevc && tv.hls && tv.ac3 && !tv.vp9);
    const p = JF.profile.build(tv, { maxBitrate: 8000000 });
    assert.strictEqual(p.MaxStreamingBitrate, 8000000);
    const mp4 = p.DirectPlayProfiles.find((d) => d.Container.indexOf('mp4') === 0);
    assert.strictEqual(mp4.VideoCodec, 'h264,hevc');
    assert.strictEqual(mp4.AudioCodec, 'aac,ac3');
    assert.ok(!p.DirectPlayProfiles.some((d) => d.Container === 'webm'));
    assert.strictEqual(p.TranscodingProfiles[0].Protocol, 'hls');
    assert.strictEqual(p.TranscodingProfiles[0].VideoCodec, 'h264');
    assert.ok(p.CodecProfiles.some((c) => c.Codec === 'hevc'));
    assert.ok(p.SubtitleProfiles.some((s) => s.Format === 'pgssub' && s.Method === 'Encode'));

    // No native HLS: progressive TS; nothing but VP8: WebM.
    const noHls = JF.profile.build(JF.profile.detect(caps(['avc1', 'mp4a', 'mp2t'])));
    assert.strictEqual(noHls.TranscodingProfiles[0].Protocol, 'http');
    assert.strictEqual(noHls.TranscodingProfiles[0].Container, 'ts');
    const vp8 = JF.profile.build(JF.profile.detect(caps(['vp8', 'vorbis'])));
    assert.strictEqual(vp8.TranscodingProfiles[0].Container, 'webm');
    assert.ok(vp8.DirectPlayProfiles.some((d) => d.Container === 'webm' && d.VideoCodec === 'vp8'));
});

// ------------------------------------------------------------------ player

test('player chooses direct play, then transcoding URLs', () => {
    const { JF } = load();
    const api = new JF.Api({ server: 'http://jf', deviceId: 'd', token: 'tok' });
    const item = { Id: 'i1' };
    const dp = JF.Player.choose(api, item, { Id: 'm', Container: 'mkv,webm', SupportsDirectPlay: true, Protocol: 'File', ETag: 'e' }, 30, 'ps');
    assert.strictEqual(dp.method, 'DirectPlay');
    assert.match(dp.url, /^http:\/\/jf\/Videos\/i1\/stream\.mkv\?static=true&mediaSourceId=m&deviceId=d&api_key=tok&Tag=e&PlaySessionId=ps$/);
    assert.strictEqual(dp.offset, 0);
    const hls = JF.Player.choose(api, item, { SupportsTranscoding: true, TranscodingUrl: '/videos/i1/master.m3u8?ApiKey=tok', TranscodingSubProtocol: 'hls' }, 30);
    assert.strictEqual(hls.method, 'Transcode');
    assert.ok(hls.hls && hls.offset === 0);
    const prog = JF.Player.choose(api, item, { SupportsTranscoding: true, TranscodingUrl: '/Videos/i1/stream.ts?x=1' }, 30);
    assert.strictEqual(prog.offset, 30, 'progressive streams start at the requested position');
    assert.match(prog.url, /&api_key=tok$/);
    assert.strictEqual(JF.Player.choose(api, item, { SupportsDirectPlay: false }, 0), null);
});

// ------------------------------------------------------------------ focus

test('focus moves within rows and grids and remembers row positions', () => {
    const { JF } = load();
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ className: 'card', offsetLeft: i * 100, offsetTop: 0, id: i }));
    const f = new JF.Focus(null);
    const row1 = { items: mk(5) };
    const grid = { items: mk(10), cols: 4 };
    f.setRows([row1, grid]);
    assert.strictEqual(f.focusedElement().id, 0);
    assert.ok(/focused/.test(row1.items[0].className));
    assert.ok(f.move('right') && f.move('right'));
    assert.strictEqual(row1.index, 2);
    assert.ok(!f.move('up'));
    assert.ok(f.move('down'));
    assert.strictEqual(f.rowIndex, 1);
    assert.ok(!f.move('left'), 'grid edge');
    assert.ok(f.move('down') && f.move('down'));
    assert.strictEqual(grid.index, 8);
    assert.ok(f.move('right') && !f.move('right'), 'last line has two items');
    assert.ok(f.move('up'));
    assert.strictEqual(grid.index, 5);
    assert.ok(f.move('up') && f.move('up'));
    assert.strictEqual(f.rowIndex, 0);
    assert.strictEqual(row1.index, 2, 'row keeps its index');
    assert.ok(!/focused/.test(grid.items[2].className));
});
