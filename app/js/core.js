/*
 * Core helpers for the Saphi client: namespace, Promise fallback, DOM and
 * formatting helpers. ES5 only: the Saphi browser may be an old engine.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
var JF = (typeof window !== 'undefined' && window.JF) || {};
if (typeof window !== 'undefined') window.JF = JF;

JF.version = '0.2.0';
JF.clientName = 'Jellyfin Saphi';

// ------------------------------------------------------------------ Promise
// A small Promises/A+ subset, used only when the engine has none.
JF.Promise = (typeof Promise !== 'undefined') ? Promise : (function () {
    function P(executor) {
        var self = this;
        self._state = 0; // 0 pending, 1 resolved, 2 rejected
        self._value = undefined;
        self._handlers = [];
        function settle(state, value) {
            if (self._state) return;
            if (state === 1 && value && typeof value.then === 'function') {
                value.then(function (v) { settle(1, v); }, function (e) { settle(2, e); });
                return;
            }
            self._state = state;
            self._value = value;
            var hs = self._handlers;
            self._handlers = [];
            for (var i = 0; i < hs.length; i++) run(hs[i]);
        }
        function run(h) {
            setTimeout(function () {
                var cb = self._state === 1 ? h.ok : h.fail;
                if (typeof cb !== 'function') {
                    (self._state === 1 ? h.resolve : h.reject)(self._value);
                    return;
                }
                try { h.resolve(cb(self._value)); } catch (e) { h.reject(e); }
            }, 0);
        }
        self._run = run;
        try {
            executor(function (v) { settle(1, v); }, function (e) { settle(2, e); });
        } catch (e) { settle(2, e); }
    }
    P.prototype.then = function (ok, fail) {
        var self = this;
        return new P(function (resolve, reject) {
            var h = { ok: ok, fail: fail, resolve: resolve, reject: reject };
            if (self._state) self._run(h); else self._handlers.push(h);
        });
    };
    P.prototype['catch'] = function (fail) { return this.then(null, fail); };
    P.resolve = function (v) { return new P(function (r) { r(v); }); };
    P.reject = function (e) { return new P(function (_, r) { r(e); }); };
    P.all = function (list) {
        return new P(function (resolve, reject) {
            var out = [];
            var left = list.length;
            if (!left) { resolve(out); return; }
            for (var i = 0; i < list.length; i++) {
                (function (i) {
                    P.resolve(list[i]).then(function (v) {
                        out[i] = v;
                        if (--left === 0) resolve(out);
                    }, reject);
                })(i);
            }
        });
    };
    return P;
})();

// ------------------------------------------------------------------ util
JF.util = {
    extend: function (target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            if (!src) continue;
            for (var k in src) {
                if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
            }
        }
        return target;
    },

    /** Builds "a=1&b=2", skipping null/undefined values. */
    query: function (params) {
        var parts = [];
        for (var k in params) {
            if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
            var v = params[k];
            if (v === null || v === undefined || v === '') continue;
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
        }
        return parts.join('&');
    },

    /** el('div', 'card focusable', 'text') */
    el: function (tag, className, text) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined && text !== null) e.textContent = String(text);
        return e;
    },

    clear: function (node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    },

    ticksToSeconds: function (ticks) {
        return (ticks || 0) / 10000000;
    },

    secondsToTicks: function (s) {
        return Math.round((s || 0) * 10000000);
    },

    /** 3725 -> "1:02:05", 65 -> "1:05" */
    formatTime: function (seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0));
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        var mm = h ? (m < 10 ? '0' + m : String(m)) : String(m);
        return (h ? h + ':' : '') + mm + ':' + (s < 10 ? '0' + s : s);
    },

    /** Runtime in ticks -> "1 h 42 min" */
    formatRuntime: function (ticks) {
        var min = Math.round(JF.util.ticksToSeconds(ticks) / 60);
        if (!min) return '';
        var h = Math.floor(min / 60);
        return (h ? h + ' h ' : '') + (min % 60) + ' min';
    },

    debounce: function (fn, ms) {
        var t = null;
        return function () {
            var args = arguments;
            var self = this;
            if (t) clearTimeout(t);
            t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
        };
    }
};
