/*
 * Saphi NativeShell for jellyfin-web (Option A).
 *
 * The reverse proxy injects this script into jellyfin-web's index.html, before
 * the jellyfin-web bundle runs. jellyfin-web then finds window.NativeShell and
 * asks it for the device ID, device profile, layout, supported features, and
 * how to exit, the same way the official Tizen and webOS apps work.
 *
 * Written in ES5 so it runs on any engine the Saphi browser may have.
 *
 * Configuration, lowest to highest precedence:
 *   1. DEFAULTS below
 *   2. window.SaphiConfig (set by /tv/config.js, served by the proxy)
 *   3. localStorage 'saphi.config' (JSON)
 *   4. URL query: ?saphi-debug=1, ?saphi-reset=1
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
(function (window) {
    'use strict';

    var VERSION = '0.1.0';
    var CONFIG_KEY = 'saphi.config';
    var DEVICE_ID_KEY = '_deviceId2'; // the key jellyfin-web itself uses

    var document = window.document;
    var navigator = window.navigator;

    // Key events jellyfin-web understands (src/scripts/keyboardNavigation.js
    // looks up keyCode first, then event.code).
    var ACTIONS = {
        Back: { keyCode: 461, code: '' },
        Pause: { keyCode: 19, code: 'Pause' },
        MediaPlay: { keyCode: 415, code: '' },
        MediaPlayPause: { keyCode: 10252, code: '' },
        MediaStop: { keyCode: 413, code: '' },
        MediaRewind: { keyCode: 412, code: '' },
        MediaFastForward: { keyCode: 417, code: '' },
        MediaTrackPrevious: { keyCode: 10232, code: '' },
        MediaTrackNext: { keyCode: 10233, code: '' },
        Find: { keyCode: 0, code: 'Find' },
        BrowserHome: { keyCode: 0, code: 'BrowserHome' }
    };

    var DEFAULTS = {
        deviceName: 'Philips Saphi TV',
        appName: 'Jellyfin for Saphi',
        // 0 = work it out from window.screen
        screenWidth: 0,
        screenHeight: 0,
        // Options passed to jellyfin-web's browserDeviceProfile builder.
        // Widen these (supportsHevc, enableHls...) once the probe shows what plays.
        profile: {
            enableMkvProgressive: false,
            enableSsaRender: true
        },
        // Remote keyCode -> action name in ACTIONS. Keys jellyfin-web already
        // knows (arrows, Enter, 461 Back, 412-417 media keys) need no entry.
        // These are guesses until the probe records the real codes.
        keyMap: {
            '19': 'Pause' // OIPF VK_PAUSE; some engines give no event.code
        },
        // Treat Backspace as Back when no text field has focus
        // (older Philips NetTV browsers sent 8 for Back).
        backspaceIsBack: false,
        // keyCode that toggles the on-screen log (406 = OIPF VK_BLUE)
        logToggleKey: 406,
        features: {
            add: [],
            remove: []
        },
        exitUrl: '',
        debug: false,
        logUrl: '/tv/log'
    };

    var BASE_FEATURES = [
        'exit',
        'exitmenu',
        'htmlaudioautoplay',
        'htmlvideoautoplay',
        'physicalvolumecontrol',
        'displaylanguage',
        'subtitleappearancesettings',
        'subtitleburnsettings'
    ];

    // ---------------------------------------------------------------- utils

    function isObject(v) {
        return Object.prototype.toString.call(v) === '[object Object]';
    }

    function merge(target, source) {
        if (!isObject(source)) return target;
        for (var k in source) {
            if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
            if (isObject(source[k]) && isObject(target[k])) {
                merge(target[k], source[k]);
            } else if (isObject(source[k])) {
                target[k] = merge({}, source[k]);
            } else {
                target[k] = source[k];
            }
        }
        return target;
    }

    function storageGet(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function storageSet(key, value) {
        try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
    }

    function storageRemove(key) {
        try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    function queryParam(name) {
        var search = (window.location && window.location.search) || '';
        var re = new RegExp('[?&]' + name.replace(/[-.]/g, '\\$&') + '=([^&#]*)');
        var m = re.exec(search);
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ---------------------------------------------------------------- config

    function loadConfig() {
        if (queryParam('saphi-reset') === '1') storageRemove(CONFIG_KEY);

        var config = merge({}, DEFAULTS);
        merge(config, window.SaphiConfig);

        var stored = storageGet(CONFIG_KEY);
        if (stored) {
            try { merge(config, JSON.parse(stored)); } catch (e) { /* bad JSON: ignore */ }
        }

        var debug = queryParam('saphi-debug');
        if (debug === '1' || debug === '0') {
            config.debug = debug === '1';
            var local = {};
            try { local = JSON.parse(stored || '{}') || {}; } catch (e) { local = {}; }
            local.debug = config.debug;
            storageSet(CONFIG_KEY, JSON.stringify(local));
        }
        return config;
    }

    var config = loadConfig();

    // ---------------------------------------------------------------- logging

    var LOG_LIMIT = 300;
    var logBuffer = [];
    var logQueue = [];
    var overlay = null;

    function stringify(arg) {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.name + ': ' + arg.message + (arg.stack ? '\n' + arg.stack : '');
        try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }

    function log(level, args) {
        var parts = [];
        for (var i = 0; i < args.length; i++) parts.push(stringify(args[i]));
        var entry = { t: new Date().getTime(), level: level, msg: parts.join(' ') };
        logBuffer.push(entry);
        if (logBuffer.length > LOG_LIMIT) logBuffer.shift();
        if (config.debug && config.logUrl) {
            logQueue.push(entry);
            if (logQueue.length > LOG_LIMIT) logQueue.shift(); // the sink is down: keep the newest
        }
        if (overlay && overlay.style.display !== 'none') renderOverlay();
    }

    function hookConsole() {
        var c = window.console;
        if (!c) return;
        var levels = ['log', 'info', 'warn', 'error', 'debug'];
        for (var i = 0; i < levels.length; i++) {
            (function (level) {
                var original = c[level];
                c[level] = function () {
                    log(level, arguments);
                    if (original) {
                        try { original.apply(c, arguments); } catch (e) { /* ignore */ }
                    }
                };
            })(levels[i]);
        }
    }

    function flushLogs() {
        if (!config.debug || !logQueue.length || !config.logUrl) return;
        var batch = logQueue;
        logQueue = [];
        try {
            var xhr = new window.XMLHttpRequest();
            xhr.open('POST', config.logUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ ua: navigator.userAgent, entries: batch }));
        } catch (e) { /* the log sink is optional */ }
    }

    function renderOverlay() {
        var lines = [];
        var start = Math.max(0, logBuffer.length - 40);
        for (var i = start; i < logBuffer.length; i++) {
            var e = logBuffer[i];
            lines.push('[' + e.level + '] ' + e.msg);
        }
        overlay.textContent = lines.join('\n');
    }

    function toggleOverlay() {
        if (!document.body) return;
        if (!overlay) {
            overlay = document.createElement('pre');
            overlay.id = 'saphiLogOverlay';
            overlay.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:50%;' +
                'overflow:hidden;margin:0;padding:8px;z-index:2147483647;background:rgba(0,0,0,.85);' +
                'color:#cfc;font:14px/1.3 monospace;white-space:pre-wrap;pointer-events:none';
            overlay.style.display = 'none';
            document.body.appendChild(overlay);
        }
        overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
        if (overlay.style.display === 'block') renderOverlay();
    }

    // ---------------------------------------------------------------- device

    function generateDeviceId() {
        var raw = navigator.userAgent + '|' + new Date().getTime() + '|' + Math.random();
        try {
            return window.btoa(raw).replace(/=/g, '1');
        } catch (e) {
            return String(Math.random()).slice(2) + String(new Date().getTime());
        }
    }

    function getDeviceId() {
        var id = storageGet(DEVICE_ID_KEY);
        if (!id) {
            id = generateDeviceId();
            storageSet(DEVICE_ID_KEY, id);
        }
        return id;
    }

    function getScreen() {
        if (config.screenWidth && config.screenHeight) {
            return { width: config.screenWidth, height: config.screenHeight };
        }
        var s = window.screen;
        if (!s || !s.width) return null;
        var dpr = window.devicePixelRatio || 1;
        return { width: Math.round(s.width * dpr), height: Math.round(s.height * dpr) };
    }

    function getFeatures() {
        var list = BASE_FEATURES.concat(config.features.add || []);
        var remove = [];
        var i;
        for (i = 0; i < (config.features.remove || []).length; i++) {
            remove.push(String(config.features.remove[i]).toLowerCase());
        }
        var out = [];
        for (i = 0; i < list.length; i++) {
            var f = String(list[i]).toLowerCase();
            if (out.indexOf(f) === -1 && remove.indexOf(f) === -1) out.push(f);
        }
        return out;
    }

    // ---------------------------------------------------------------- keys

    function isTextField(el) {
        if (!el || !el.tagName) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName !== 'INPUT') return false;
        var nonText = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'reset', 'submit'];
        return nonText.indexOf((el.type || 'text').toLowerCase()) === -1;
    }

    // Returns the action name for a key event, or null when jellyfin-web can
    // handle the event as it is.
    function translateKey(e) {
        if (e.saphiTranslated) return null;
        var action = config.keyMap[String(e.keyCode)] || null;
        if (!action && e.keyCode === 8 && config.backspaceIsBack && !isTextField(document.activeElement)) {
            action = 'Back';
        }
        if (!action || !ACTIONS[action]) return null;
        var target = ACTIONS[action];
        // Already in the form jellyfin-web expects.
        if (target.keyCode && e.keyCode === target.keyCode && (!target.code || e.code === target.code)) return null;
        return action;
    }

    function makeKeyEvent(type, action) {
        var target = ACTIONS[action];
        var ev;
        try {
            ev = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, key: action, code: target.code });
        } catch (err) {
            ev = document.createEvent('Event');
            ev.initEvent(type, true, true);
        }
        // keyCode/code are read-only getters on real KeyboardEvents; shadow them.
        var props = { keyCode: target.keyCode, which: target.keyCode, code: target.code, key: action, saphiTranslated: true };
        for (var p in props) {
            try {
                Object.defineProperty(ev, p, { value: props[p], configurable: true });
            } catch (err) { /* ignore */ }
        }
        return ev;
    }

    function onKeyDown(e) {
        if (config.debug && !e.saphiTranslated) {
            log('debug', ['key', 'keyCode=' + e.keyCode, 'key=' + e.key, 'code=' + e.code]);
        }
        if (config.logToggleKey && e.keyCode === config.logToggleKey && config.debug) {
            toggleOverlay();
            e.preventDefault();
            return;
        }
        var action = translateKey(e);
        if (!action) return;
        e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        (document.activeElement || document.body || window).dispatchEvent(makeKeyEvent('keydown', action));
    }

    // ---------------------------------------------------------------- shell

    var AppInfo = {
        deviceId: getDeviceId(),
        deviceName: config.deviceName,
        appName: config.appName,
        appVersion: VERSION
    };

    function exit() {
        log('info', ['AppHost.exit']);
        try { window.close(); } catch (e) { /* ignore */ }
        // window.close() is ignored for pages the user opened directly.
        window.setTimeout(function () {
            if (config.exitUrl) {
                window.location.href = config.exitUrl;
            } else if (window.history && window.history.length > 1) {
                window.history.go(-(window.history.length - 1));
            }
        }, 300);
    }

    function noop(name) {
        return function () { log('debug', ['NativeShell.' + name]); };
    }

    window.NativeShell = {
        AppHost: {
            init: function () {
                log('info', ['AppHost.init', AppInfo]);
                return window.Promise ? window.Promise.resolve(AppInfo) : AppInfo;
            },
            appName: function () { return AppInfo.appName; },
            appVersion: function () { return AppInfo.appVersion; },
            deviceId: function () { return AppInfo.deviceId; },
            deviceName: function () { return AppInfo.deviceName; },
            exit: exit,
            getDefaultLayout: function () { return 'tv'; },
            getDeviceProfile: function (profileBuilder) {
                var options = merge({}, config.profile);
                log('info', ['AppHost.getDeviceProfile', options]);
                return profileBuilder(options);
            },
            getSyncProfile: function (profileBuilder) {
                return profileBuilder({ enableMkvProgressive: false });
            },
            screen: getScreen,
            supports: function (command) {
                return !!command && getFeatures().indexOf(String(command).toLowerCase()) !== -1;
            }
        },
        downloadFile: noop('downloadFile'),
        enableFullscreen: noop('enableFullscreen'),
        disableFullscreen: noop('disableFullscreen'),
        getPlugins: function () { return []; },
        openUrl: function (url) { log('info', ['NativeShell.openUrl', url]); },
        updateMediaSession: noop('updateMediaSession'),
        hideMediaSession: noop('hideMediaSession')
    };

    // Exposed for the tests and for poking at from the log overlay.
    window.SaphiShell = {
        version: VERSION,
        config: config,
        actions: ACTIONS,
        features: getFeatures,
        translateKey: translateKey,
        logs: function () { return logBuffer.slice(); },
        flushLogs: flushLogs,
        queued: function () { return logQueue.length; },
        toggleOverlay: toggleOverlay
    };

    hookConsole();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('error', function (e) {
        log('error', ['window.onerror', e.message, (e.filename || '') + ':' + (e.lineno || 0)]);
    });
    window.addEventListener('unhandledrejection', function (e) {
        log('error', ['unhandledrejection', e.reason]);
    });
    if (config.debug) {
        window.setInterval(flushLogs, 2000);
    }

    log('info', ['Saphi shell ' + VERSION, navigator.userAgent]);
})(window);
