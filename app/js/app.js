/*
 * App bootstrap: session, settings, key routing, screen scaling.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
JF.app = (function () {
    'use strict';

    var platform = JF.platform;
    var storage = platform.storage;
    var util = JF.util;

    var DEFAULT_SETTINGS = {
        maxBitrate: 20000000,
        skipForward: 30,
        skipBack: 10,
        autoplayNext: true,
        debug: false,
        // Capability overrides, e.g. { hevc: true, mkv: false }, set after
        // trying test clips on the TV.
        caps: {},
        keyMap: {}
    };

    var app = {
        session: {},
        settings: {},
        api: null,
        dirty: false,
        quickConnectInterval: 5000,
        caps: null,
        exitArmedAt: 0,

        start: function (root) {
            app.session = storage.get('session', {}) || {};
            app.settings = util.extend({}, DEFAULT_SETTINGS, storage.get('settings', {}));
            // ?debug=1 turns on the remote log from the first screen, before
            // Settings can be reached (for example to log key codes).
            if (/[?&]debug=1\b/.test(window.location.search || '')) app.settings.debug = true;
            app.applySettings();
            JF.router.init(root);
            app.scale();
            window.addEventListener('resize', app.scale);
            document.addEventListener('keydown', app.onKeyDown, true);
            // Some TV browsers drive a pointer with the remote and turn OK
            // into a click instead of a keydown, so pointer input works too.
            document.addEventListener('click', app.onClick, true);
            document.addEventListener('mouseover', app.onPointerOver, true);
            document.addEventListener('mousemove', app.onPointerMove, true);
            app.initHistory();
            app.makeApi();
            JF.log.info('Jellyfin Saphi ' + JF.version, navigator.userAgent);
            JF.log.info('capabilities', app.capsSummary());

            if (app.session.server && app.session.token) {
                JF.router.reset(JF.screens.Home(app));
                // Check the token is still valid; Home handles 401s too.
                app.api.currentUser().then(function (u) {
                    app.session.userName = u.Name;
                    app.saveSession();
                }, function (err) {
                    if (err && err.status === 401) app.sessionExpired();
                });
            } else if (app.session.server) {
                JF.router.reset(JF.screens.Login(app));
            } else {
                JF.router.reset(JF.screens.Connect(app));
            }
        },

        makeApi: function () {
            app.api = new JF.Api({
                server: app.session.server,
                token: app.session.token,
                userId: app.session.userId,
                deviceId: platform.deviceId(app.session.userId),
                deviceName: platform.deviceName()
            });
        },

        /**
         * The server to suggest on the Connect screen: ?server=..., or the
         * Jellyfin server this page is served from (/web/saphi/ or a proxy).
         */
        defaultServer: function () {
            var m = /[?&]server=([^&#]+)/.exec(window.location.search || '');
            if (m) return decodeURIComponent(m[1]);
            var loc = window.location;
            if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return '';
            var path = loc.pathname.replace(/\/web\/.*$/, '').replace(/\/(tv|saphi)\/.*$/, '');
            return loc.protocol + '//' + loc.host + (path === '/' ? '' : path);
        },

        setServer: function (address, info) {
            app.session = { server: address, serverName: info.ServerName, serverId: info.Id };
            app.saveSession();
            app.makeApi();
        },

        loggedIn: function (auth) {
            app.session.token = auth.AccessToken;
            app.session.userId = auth.User.Id;
            app.session.userName = auth.User.Name;
            app.saveSession();
            // Re-create the client so the per-user device ID is used.
            app.makeApi();
            JF.log.info('signed in as', auth.User.Name);
            JF.router.reset(JF.screens.Home(app));
        },

        sessionExpired: function () {
            if (!app.session.token) return;
            JF.log.warn('session expired');
            delete app.session.token;
            delete app.session.userId;
            app.saveSession();
            app.makeApi();
            JF.ui.toast('Please sign in again.');
            JF.router.reset(JF.screens.Login(app));
        },

        logout: function (changeServer) {
            app.api.logout();
            delete app.session.token;
            delete app.session.userId;
            if (changeServer) app.session = {};
            app.saveSession();
            app.makeApi();
            JF.router.reset(changeServer ? JF.screens.Connect(app) : JF.screens.Login(app));
        },

        saveSession: function () { storage.set('session', app.session); },

        saveSettings: function () {
            storage.set('settings', app.settings);
            app.applySettings();
        },

        applySettings: function () {
            JF.log.remote = !!app.settings.debug;
            platform.setKeyOverrides(app.settings.keyMap || {});
            app.caps = null;
            if (app.flushTimer) clearInterval(app.flushTimer);
            app.flushTimer = app.settings.debug ? setInterval(JF.log.flush, 2000) : null;
        },

        capabilities: function () {
            if (!app.caps) {
                // On Saphi, canPlayType says "probably" even for AV1, which
                // the TV cannot decode. Until real test clips have played,
                // only H.264 is trusted there. Settings can switch the
                // others on (settings.caps).
                var saphiDefaults = platform.isSaphi() ? { hevc: false, vp9: false, av1: false } : {};
                app.caps = util.extend(JF.profile.detect(document.createElement('video')), saphiDefaults, app.settings.caps || {});
            }
            return app.caps;
        },

        capsSummary: function () {
            var c = app.capabilities();
            var names = ['h264', 'hevc', 'vp9', 'av1', 'aac', 'ac3', 'eac3', 'mkv', 'ts', 'hls'];
            var yes = [];
            for (var i = 0; i < names.length; i++) if (c[names[i]]) yes.push(names[i].toUpperCase());
            return yes.join(' ') || 'none detected';
        },

        deviceProfile: function () {
            return JF.profile.build(app.capabilities(), {
                maxBitrate: app.settings.maxBitrate,
                maxWidth: app.settings.maxWidth,
                maxHeight: app.settings.maxHeight
            });
        },

        play: function (item, opts) {
            opts = opts || {};
            var cur = JF.router.current();
            if (opts.replace && cur && cur.player) JF.router.pop();
            JF.router.push(JF.Player(app, item, opts));
        },

        confirmExit: function () {
            var now = new Date().getTime();
            if (now - app.exitArmedAt < 2500) {
                app.exiting = true;
                platform.exit();
            } else {
                app.exitArmedAt = now;
                JF.ui.toast('Press Back again to exit');
            }
        },

        /**
         * The Saphi browser keeps the Back key for itself: it goes back in
         * the browser history, and the page never sees a keydown. So the app
         * keeps one extra "guard" history entry. Back pops it (popstate);
         * the guard is pushed again and the app handles Back as if the key
         * had come through.
         */
        initHistory: function () {
            var h = window.history;
            if (!h || !h.pushState) return;
            try {
                h.replaceState({ jf: 'base' }, '');
                h.pushState({ jf: 'guard' }, '');
            } catch (e) { return; }
            window.addEventListener('popstate', app.onPopState);
        },

        onPopState: function () {
            if (app.exiting) return;
            if (app.settings.debug) JF.log.debug('history back -> back');
            try { window.history.pushState({ jf: 'guard' }, ''); } catch (e) { /* ignore */ }
            app.dispatch('back');
        },

        onKeyDown: function (e) {
            var action = platform.keyAction(e, document.activeElement);
            if (app.settings.debug) JF.log.debug('key', e.keyCode, e.key || '', '->', action || '-');
            if (!action) return;
            if (action === 'blue' && app.settings.debug) {
                JF.log.toggleOverlay();
                e.preventDefault();
                return;
            }
            if (!JF.router.current()) return;
            e.preventDefault();
            app.dispatch(action);
        },

        /** Routes an action ('ok', 'back', 'play'…) to the current screen. */
        dispatch: function (action) {
            var screen = JF.router.current();
            if (!screen) return;
            if (screen.onKey && screen.onKey(action)) return;
            var focus = screen.focus;
            if (action === 'submit') action = 'down';
            if (focus) {
                if (action === 'ok') { focus.select(); return; }
                if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
                    if (JF.platform.isTextField(document.activeElement)) document.activeElement.blur();
                    focus.move(action);
                    return;
                }
            }
            if (action === 'back') {
                if (!JF.router.pop()) app.confirmExit();
            }
        },

        /**
         * The focusable element of the current screen that contains node,
         * or null. Walks up from node to the screen root.
         */
        focusTargetFor: function (node) {
            var screen = JF.router.current();
            var focus = screen && screen.focus;
            if (!focus) return null;
            while (node && node !== document) {
                for (var r = 0; r < focus.rows.length; r++) {
                    if (focus.rows[r].items.indexOf(node) !== -1) return node;
                }
                node = node.parentNode;
            }
            return null;
        },

        onClick: function (e) {
            if (e.target && /\brow-nav\b/.test(e.target.className || '')) {
                e.preventDefault();
                app.pageRow(e.target);
                return;
            }
            var target = app.focusTargetFor(e.target);
            if (app.settings.debug) JF.log.debug('click', e.target && e.target.className, '->', target ? 'focusable' : '-');
            if (!target) return;
            var focus = JF.router.current().focus;
            focus.focusElement(target);
            // Text fields keep the browser's own click: it focuses the field
            // and opens the on-screen keyboard.
            if (platform.isTextField(target)) return;
            e.preventDefault();
            focus.select();
        },

        /**
         * A ‹ or › button of a card row: moves the row by a page of cards.
         * This is how a pointer reaches cards that are off screen.
         */
        pageRow: function (button) {
            var screen = JF.router.current();
            var focus = screen && screen.focus;
            var track = button.parentNode && button.parentNode.querySelector('.row-track');
            if (!focus || !track) return;
            for (var r = 0; r < focus.rows.length; r++) {
                var row = focus.rows[r];
                if (row.track !== track) continue;
                var step = /\bnext\b/.test(button.className) ? app.ROW_PAGE : -app.ROW_PAGE;
                focus.rowIndex = r;
                row.index = Math.max(0, Math.min(row.items.length - 1, row.index + step));
                focus.apply();
                app.pointerLock();
                return;
            }
        },

        ROW_PAGE: 5,
        pointer: { x: -1, y: -1, lockX: -2, lockY: -2 },

        onPointerMove: function (e) {
            app.pointer.x = e.clientX;
            app.pointer.y = e.clientY;
        },

        /**
         * After the view moves under a still pointer (a row or the screen
         * scrolls), the browser may report the pointer over a new card. That
         * must not move focus again, or the view would keep scrolling by
         * itself. Hover moves focus only once the pointer itself has moved.
         */
        pointerLock: function () {
            app.pointer.lockX = app.pointer.x;
            app.pointer.lockY = app.pointer.y;
        },

        onPointerOver: function (e) {
            // Don't pull focus away from a field the user is typing in.
            if (platform.isTextField(document.activeElement)) return;
            if (e.clientX === app.pointer.lockX && e.clientY === app.pointer.lockY) return;
            var target = app.focusTargetFor(e.target);
            var focus = target && JF.router.current().focus;
            if (!focus || focus.focusedElement() === target) return;
            focus.focusElement(target);
            app.pointer.x = e.clientX;
            app.pointer.y = e.clientY;
            app.pointerLock();
        },

        /** Lays the 1920x1080 design canvas over the real window size. */
        scale: function () {
            var root = document.getElementById('app');
            if (!root) return;
            var w = window.innerWidth || 1920;
            var h = window.innerHeight || 1080;
            var s = Math.min(w / 1920, h / 1080);
            var t = 'scale(' + s + ')';
            root.style.transform = root.style.webkitTransform = t;
            root.style.left = Math.round((w - 1920 * s) / 2) + 'px';
            root.style.top = Math.round((h - 1080 * s) / 2) + 'px';
        }
    };

    return app;
})();
