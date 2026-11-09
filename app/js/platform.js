/*
 * Platform layer: the only place that knows about Saphi key codes, storage
 * quirks, device identity and exiting. A desktop browser uses the same code
 * (keyboard arrows, Enter, Escape/Backspace for Back).
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
JF.platform = (function () {
    'use strict';

    // keyCode -> action. OIPF/HbbTV codes (VK_*) are the likely Saphi codes;
    // confirm them with the probe and add overrides via setKeyOverrides().
    var KEY_CODES = {
        37: 'left', 38: 'up', 39: 'right', 40: 'down',
        13: 'ok', 32: 'ok',
        8: 'back', 27: 'back', 461: 'back', 10009: 'back', 166: 'back',
        415: 'play', 19: 'pause', 413: 'stop', 412: 'rewind', 417: 'forward',
        179: 'playpause', 10252: 'playpause', 463: 'playpause',
        176: 'next', 425: 'next', 10233: 'next',
        177: 'previous', 424: 'previous', 10232: 'previous',
        403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
        33: 'pageup', 34: 'pagedown', 427: 'pageup', 428: 'pagedown',
        457: 'info', 73: 'info'
    };
    // event.key names, for engines that report them.
    var KEY_NAMES = {
        ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down',
        Left: 'left', Up: 'up', Right: 'right', Down: 'down',
        Enter: 'ok', Escape: 'back', Esc: 'back', GoBack: 'back', BrowserBack: 'back',
        MediaPlay: 'play', MediaPause: 'pause', MediaPlayPause: 'playpause',
        MediaStop: 'stop', MediaRewind: 'rewind', MediaFastForward: 'forward',
        MediaTrackNext: 'next', MediaTrackPrevious: 'previous',
        ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue'
    };
    var overrides = {};

    function isTextField(el) {
        if (!el || !el.tagName) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName !== 'INPUT') return false;
        var t = (el.type || 'text').toLowerCase();
        return ['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'file', 'color', 'hidden'].indexOf(t) === -1;
    }

    /**
     * Maps a keydown event to an action name ('up', 'ok', 'back', 'play'...),
     * or null. Keys a text field needs (typing, caret, Backspace, Space) stay
     * with the field; arrows up/down and Back/Escape still leave it.
     */
    function keyAction(e, activeElement) {
        var code = e.keyCode || e.which || 0;
        var action = overrides[code] || KEY_CODES[code] || KEY_NAMES[e.key] || null;
        if (!action) return null;
        if (isTextField(activeElement)) {
            // Everything else (letters, Space, Backspace, caret keys) is typing.
            if (code === 13) return 'submit';
            if (action === 'up' || action === 'down') return action;
            if (action === 'back' && code !== 8) return 'back';
            return null;
        }
        return action;
    }

    function setKeyOverrides(map) {
        overrides = {};
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) overrides[parseInt(k, 10)] = map[k];
        }
    }

    // ------------------------------------------------------------ storage
    // localStorage, falling back to memory (the session still works, but
    // logins are lost when the browser closes).
    var memory = {};
    var storage = {
        get: function (key, fallback) {
            var raw = null;
            try { raw = window.localStorage.getItem('jf.' + key); } catch (e) { raw = memory[key]; }
            if (raw === null || raw === undefined) return fallback;
            try { return JSON.parse(raw); } catch (e) { return fallback; }
        },
        set: function (key, value) {
            var raw = JSON.stringify(value);
            try { window.localStorage.setItem('jf.' + key, raw); } catch (e) { memory[key] = raw; }
        },
        remove: function (key) {
            try { window.localStorage.removeItem('jf.' + key); } catch (e) { /* ignore */ }
            delete memory[key];
        }
    };

    // ------------------------------------------------------------ device
    function randomId() {
        var s = '';
        for (var i = 0; i < 4; i++) s += Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
        return s + new Date().getTime().toString(16);
    }

    function baseDeviceId() {
        var id = storage.get('deviceId');
        if (!id) {
            id = randomId();
            storage.set('deviceId', id);
        }
        return id;
    }

    /** 32-bit FNV-1a, hex. Enough to make a stable per-user suffix. */
    function hash(str) {
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    /**
     * The device ID sent to the server. It differs per user, so that one
     * user logging in does not end another user's session on the same TV
     * (the same idea as jellyfin-androidtv).
     */
    function deviceId(userId) {
        var base = baseDeviceId();
        return userId ? base + '-' + hash(base + userId) : base;
    }

    function deviceName() {
        return storage.get('deviceName') || 'Philips Saphi TV';
    }

    function exit() {
        try { window.close(); } catch (e) { /* ignore */ }
        setTimeout(function () {
            if (window.history && window.history.length > 1) {
                window.history.go(-(window.history.length - 1));
            }
        }, 300);
    }

    function isSaphi(ua) {
        ua = (ua || (window.navigator && window.navigator.userAgent) || '').toLowerCase();
        return /saphi|philipstv|nettv|tpvision|tpv\b/.test(ua);
    }

    return {
        keyAction: keyAction,
        setKeyOverrides: setKeyOverrides,
        isTextField: isTextField,
        storage: storage,
        deviceId: deviceId,
        deviceName: deviceName,
        exit: exit,
        isSaphi: isSaphi,
        hash: hash
    };
})();
