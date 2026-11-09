/*
 * Screens: Connect, Login, Home, Library, Details, Settings.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
JF.screens = (function () {
    'use strict';

    var util = JF.util;
    var ui = JF.ui;
    var el = util.el;

    function input(type, placeholder, value) {
        var i = document.createElement('input');
        i.type = type;
        i.className = 'field focusable';
        i.placeholder = placeholder;
        if (value) i.value = value;
        i.setAttribute('autocomplete', 'off');
        i.setAttribute('autocapitalize', 'off');
        i.setAttribute('spellcheck', 'false');
        return i;
    }

    function message(text, isError) {
        return el('div', 'message' + (isError ? ' error' : ''), text);
    }

    function errorText(err) {
        if (!err) return 'Something went wrong.';
        if (err.status === 401) return 'Wrong user name or password.';
        if (err.status === 0) return 'Cannot reach the server. Check the address and the network.';
        return err.message || String(err);
    }

    // ================================================================ connect

    function Connect(app) {
        var s = ui.screen('screen-connect');
        var box = el('div', 'panel');
        box.appendChild(el('h1', 'brand', 'Jellyfin'));
        box.appendChild(el('p', 'hint', 'Enter your Jellyfin server address, for example 192.168.1.10 or jellyfin.example.com'));
        var field = input('text', 'Server address', app.session.server || app.defaultServer() || '');
        var status = el('div', 'status');
        var go = ui.button('Connect', connect, 'primary');
        box.appendChild(field);
        box.appendChild(go);
        box.appendChild(status);
        s.content.appendChild(box);

        var focus = new JF.Focus(null);
        var busy = false;

        function connect() {
            if (busy) return;
            var value = field.value;
            if (!value) { field.focus(); return; }
            busy = true;
            util.clear(status);
            status.appendChild(ui.spinner('Connecting…'));
            JF.Api.findServer(value, { deviceId: JF.platform.deviceId(), deviceName: JF.platform.deviceName() })
                .then(function (found) {
                    busy = false;
                    JF.log.info('server found', found.address, found.info.Version);
                    app.setServer(found.address, found.info);
                    JF.router.push(Login(app));
                }, function (err) {
                    busy = false;
                    util.clear(status);
                    status.appendChild(message(errorText(err), true));
                });
        }

        return {
            el: s.el,
            focus: focus,
            onShow: function () {
                focus.setRows([{ items: [field] }, { items: [go] }], field.value ? 1 : 0);
            },
            onKey: function (action) {
                if (action === 'submit') { field.blur(); focus.setRows([{ items: [field] }, { items: [go] }], 1); return true; }
                return false;
            }
        };
    }

    // ================================================================ login

    function Login(app) {
        var api = app.api;
        var s = ui.screen('screen-login');
        var box = el('div', 'panel');
        box.appendChild(el('h1', 'brand', app.session.serverName || 'Jellyfin'));
        box.appendChild(el('p', 'hint', app.session.server));

        var qc = el('div', 'quickconnect');
        box.appendChild(qc);

        var user = input('text', 'User name', app.session.userName || '');
        var pass = input('password', 'Password');
        var signIn = ui.button('Sign in', login, 'primary');
        var changeServer = ui.button('Change server', function () {
            stopPolling();
            JF.router.reset(Connect(app));
        });
        var status = el('div', 'status');
        box.appendChild(user);
        box.appendChild(pass);
        var buttons = el('div', 'button-row');
        buttons.appendChild(signIn);
        buttons.appendChild(changeServer);
        box.appendChild(buttons);
        box.appendChild(status);
        s.content.appendChild(box);

        var focus = new JF.Focus(null);
        var pollTimer = null;
        var alive = true;

        function stopPolling() {
            if (pollTimer) clearTimeout(pollTimer);
            pollTimer = null;
        }

        function rows(index) {
            focus.setRows([{ items: [user] }, { items: [pass] }, { items: [signIn, changeServer] }], index);
        }

        function done(auth) {
            stopPolling();
            app.loggedIn(auth);
        }

        function login() {
            util.clear(status);
            status.appendChild(ui.spinner('Signing in…'));
            api.authenticateByName(user.value, pass.value).then(done, function (err) {
                util.clear(status);
                status.appendChild(message(errorText(err), true));
            });
        }

        function startQuickConnect() {
            api.quickConnectEnabled().then(function (enabled) {
                if (!enabled || !alive) return null;
                return api.quickConnectInitiate().then(function (r) {
                    if (!alive || !r) return;
                    util.clear(qc);
                    qc.appendChild(el('div', 'qc-label', 'Quick Connect code'));
                    qc.appendChild(el('div', 'qc-code', r.Code));
                    qc.appendChild(el('div', 'hint',
                        'On your phone or computer, open Jellyfin → your profile → Quick Connect, and enter this code. Or sign in below.'));
                    poll(r.Secret);
                });
            }).then(null, function (err) {
                JF.log.warn('Quick Connect unavailable', err);
            });
        }

        function poll(secret) {
            stopPolling();
            pollTimer = setTimeout(function () {
                api.quickConnectState(secret).then(function (ok) {
                    if (!alive) return;
                    if (ok) {
                        api.authenticateWithQuickConnect(secret).then(done, function (err) {
                            status.appendChild(message(errorText(err), true));
                        });
                    } else {
                        poll(secret);
                    }
                }, function (err) {
                    // The code expired (the server forgets it after a few minutes).
                    if (alive && err && (err.status === 404 || err.status === 401)) startQuickConnect();
                    else if (alive) poll(secret);
                });
            }, app.quickConnectInterval);
        }

        return {
            el: s.el,
            focus: focus,
            onShow: function () {
                rows(user.value ? 1 : 0);
                if (!pollTimer) startQuickConnect();
            },
            onHide: stopPolling,
            destroy: function () { alive = false; stopPolling(); },
            onKey: function (action) {
                if (action === 'submit') {
                    var r = focus.rowIndex;
                    document.activeElement.blur();
                    if (r === 1) login(); else rows(r + 1);
                    return true;
                }
                return false;
            }
        };
    }

    // ================================================================ rows

    /**
     * A titled horizontal row of cards. Returns { el, focusRow } where
     * focusRow is the JF.Focus row object.
     */
    function cardRow(api, title, items, kind, onSelect) {
        var section = el('div', 'row');
        section.appendChild(el('div', 'row-title', title));
        var viewport = el('div', 'row-viewport');
        var track = el('div', 'row-track');
        var cards = [];
        for (var i = 0; i < items.length; i++) {
            var c = ui.card(api, items[i], kind);
            cards.push(c);
            track.appendChild(c);
        }
        viewport.appendChild(track);
        // ‹ › page the row for a pointer (the Saphi remote moves a pointer;
        // arrow keys never reach the page). Handled in JF.app.pageRow.
        if (items.length > 1) {
            viewport.appendChild(el('div', 'row-nav prev', '‹'));
            viewport.appendChild(el('div', 'row-nav next', '›'));
        }
        section.appendChild(viewport);
        ui.reveal(cards, 0, 9);
        return {
            el: section,
            focusRow: {
                items: cards,
                track: track,
                anchor: section,
                onSelect: function (i) { onSelect(items[i]); },
                onFocus: function (i) { ui.reveal(cards, i - 2, i + 9); }
            }
        };
    }

    function openItem(app, item) {
        if (item.CollectionType || item.Type === 'CollectionFolder' || item.Type === 'UserView' ||
            item.Type === 'Folder' || item.Type === 'BoxSet') {
            JF.router.push(Library(app, item));
        } else {
            JF.router.push(Details(app, item));
        }
    }

    // ================================================================ home

    var SUPPORTED_VIEWS = ['movies', 'tvshows', 'homevideos', 'musicvideos', 'boxsets', 'mixed', undefined, null, ''];

    function Home(app) {
        var api = app.api;
        var s = ui.screen('screen-home');
        var header = el('div', 'header');
        header.appendChild(el('div', 'header-title', 'Home'));
        var settingsBtn = ui.button('Settings', function () { JF.router.push(Settings(app)); }, 'header-btn');
        header.appendChild(settingsBtn);
        s.el.insertBefore(header, s.content);
        var loading = ui.spinner();
        s.content.appendChild(loading);

        var focus = new JF.Focus(s.content);
        var sections = [];
        var loadedAt = 0;
        var token = 0;

        function selectItem(item) { openItem(app, item); }

        function render(results) {
            // Remember where focus was by row key and item ID, not by
            // position: rows come and go (Continue Watching, Next Up).
            var prevKey = focus.rowIndex > 0 ? sections[focus.rowIndex - 1] : null;
            var prevRow = focus.row();
            var prevEl = focus.focusedElement();
            var prevId = prevEl && prevEl.jfItem ? prevEl.jfItem.Id : null;
            var prevIndex = prevRow ? prevRow.index : 0;

            util.clear(s.content);
            var rows = [{ items: [settingsBtn] }];
            sections = [];
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (!r || !r.items.length) continue;
                var row = cardRow(api, r.title, r.items, r.kind, selectItem);
                s.content.appendChild(row.el);
                rows.push(row.focusRow);
                sections.push(r.key);
            }
            if (rows.length === 1) s.content.appendChild(message('Nothing to show yet. Add media in the Jellyfin dashboard.'));

            var keep = rows.length > 1 ? 1 : 0;
            if (prevRow && focus.rowIndex === 0) keep = 0;
            var k = prevKey ? sections.indexOf(prevKey) : -1;
            if (k !== -1) {
                keep = k + 1;
                var target = rows[keep];
                target.index = Math.min(prevIndex, target.items.length - 1);
                for (var j = 0; prevId && j < target.items.length; j++) {
                    if (target.items[j].jfItem && target.items[j].jfItem.Id === prevId) target.index = j;
                }
            }
            focus.setRows(rows, keep);
        }

        function load() {
            var my = ++token;
            loadedAt = new Date().getTime();
            api.getViews().then(function (views) {
                var jobs = [
                    api.getResume().then(function (items) { return { key: 'resume', title: 'Continue Watching', items: items, kind: 'thumb' }; }),
                    api.getNextUp().then(function (items) { return { key: 'nextup', title: 'Next Up', items: items, kind: 'thumb' }; })
                ];
                var libs = [];
                for (var i = 0; i < views.length; i++) {
                    if (SUPPORTED_VIEWS.indexOf(views[i].CollectionType) !== -1) libs.push(views[i]);
                }
                for (var j = 0; j < libs.length; j++) {
                    (function (v) {
                        jobs.push(api.getLatest(v.Id).then(function (items) {
                            return { key: 'latest-' + v.Id, title: 'Latest ' + v.Name, items: items, kind: 'poster' };
                        }, function () { return null; }));
                    })(libs[j]);
                }
                var first = { key: 'views', title: 'My Media', items: views, kind: 'thumb' };
                return JF.Promise.all(jobs).then(function (rest) {
                    // Order as on Android TV: Continue Watching, Next Up, My Media, Latest…
                    return [rest[0], rest[1], first].concat(rest.slice(2));
                });
            }).then(function (results) {
                if (my === token) render(results);
            }, function (err) {
                if (my !== token) return;
                if (err && err.status === 401) { app.sessionExpired(); return; }
                util.clear(s.content);
                s.content.appendChild(message(errorText(err), true));
                var retry = ui.button('Try again', load, 'primary');
                s.content.appendChild(retry);
                focus.setRows([{ items: [settingsBtn] }, { items: [retry] }], 1);
            });
        }

        return {
            el: s.el,
            focus: focus,
            onShow: function () {
                // Refresh when coming back after a while (progress, new episodes).
                if (!loadedAt || new Date().getTime() - loadedAt > 30000 || app.dirty) {
                    app.dirty = false;
                    load();
                }
            },
            onKey: function (action) {
                if (action === 'back') {
                    if (focus.rowIndex > 1) { focus.setRows(focus.rows, 1); return true; }
                    app.confirmExit();
                    return true;
                }
                return false;
            }
        };
    }

    // ================================================================ library

    var PAGE = 60;

    function Library(app, view) {
        var api = app.api;
        var s = ui.screen('screen-library');
        var header = el('div', 'header');
        header.appendChild(el('div', 'header-title', view.Name || ''));
        var count = el('div', 'header-sub', '');
        header.appendChild(count);
        s.el.insertBefore(header, s.content);
        var grid = el('div', 'grid');
        s.content.appendChild(grid);
        var status = ui.spinner();
        s.content.appendChild(status);

        var focus = new JF.Focus(s.content);
        var cards = [];
        var items = [];
        var total = -1;
        var loading = false;
        var COLS = 7;
        var params = { parentId: view.Id, sortBy: 'SortName', sortOrder: 'Ascending', recursive: true };
        var ct = view.CollectionType;
        if (ct === 'movies') params.includeItemTypes = 'Movie';
        else if (ct === 'tvshows') params.includeItemTypes = 'Series';
        else if (ct === 'boxsets') params.includeItemTypes = 'BoxSet';
        else if (view.Type === 'BoxSet' || view.Type === 'Folder') params.recursive = false;
        else params.includeItemTypes = 'Movie,Series,Video';

        var row = {
            items: cards, cols: COLS,
            onSelect: function (i) { openItem(app, items[i]); },
            onFocus: function (i) { ui.reveal(cards, i - COLS * 2, i + COLS * 3); },
            onNearEnd: function () { more(); }
        };

        function more() {
            if (loading || (total >= 0 && items.length >= total)) return;
            loading = true;
            api.getItems(util.extend({ startIndex: items.length, limit: PAGE }, params)).then(function (r) {
                loading = false;
                total = r.TotalRecordCount || 0;
                count.textContent = total + ' items';
                var added = r.Items || [];
                for (var i = 0; i < added.length; i++) {
                    var c = ui.card(api, added[i], 'poster');
                    items.push(added[i]);
                    cards.push(c);
                    grid.appendChild(c);
                }
                if (status.parentNode) status.parentNode.removeChild(status);
                if (!items.length) s.content.appendChild(message('This library is empty.'));
                if (focus.rows.length) {
                    focus.apply();
                } else {
                    focus.setRows([row]);
                    ui.reveal(cards, 0, COLS * 3);
                }
            }, function (err) {
                loading = false;
                if (err && err.status === 401) { app.sessionExpired(); return; }
                util.clear(status);
                status.appendChild(message(errorText(err), true));
            });
        }

        more();
        return { el: s.el, focus: focus };
    }

    // ================================================================ details

    function Details(app, stub) {
        var api = app.api;
        var s = ui.screen('screen-details');
        var backdrop = el('img', 'backdrop');
        backdrop.alt = '';
        s.el.insertBefore(backdrop, s.content);
        s.el.insertBefore(el('div', 'backdrop-shade'), s.content);
        s.content.appendChild(ui.spinner());
        var focus = new JF.Focus(s.content);
        var item = null;

        function play(fromStart) {
            var start = fromStart ? 0 : (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
            app.play(item, { startTicks: start });
        }

        function render() {
            util.clear(s.content);
            ui.setImage(backdrop, api.imageUrl(item, 'Backdrop', { width: 1920, height: 1080, quality: 60 }));

            var info = el('div', 'details-info');
            if (item.Type === 'Episode' && item.SeriesName) info.appendChild(el('div', 'details-series', item.SeriesName));
            info.appendChild(el('h1', 'details-title', item.Name));
            var meta = [];
            if (item.Type === 'Episode' && item.IndexNumber !== undefined) {
                meta.push('S' + (item.ParentIndexNumber || 0) + ':E' + item.IndexNumber);
            }
            if (item.ProductionYear) meta.push(item.ProductionYear);
            if (item.OfficialRating) meta.push(item.OfficialRating);
            if (item.RunTimeTicks) meta.push(util.formatRuntime(item.RunTimeTicks));
            if (item.CommunityRating) meta.push('★ ' + item.CommunityRating.toFixed(1));
            info.appendChild(el('div', 'details-meta', meta.join('   ·   ')));
            if (item.Genres && item.Genres.length) info.appendChild(el('div', 'details-genres', item.Genres.slice(0, 4).join(', ')));
            if (item.Overview) info.appendChild(el('p', 'details-overview', item.Overview));
            s.content.appendChild(info);

            var buttons = el('div', 'button-row');
            var btns = [];
            var playable = item.MediaType === 'Video' || item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video';
            var resumeTicks = item.UserData && item.UserData.PlaybackPositionTicks;
            if (playable) {
                if (resumeTicks) {
                    btns.push(ui.button('Resume from ' + util.formatTime(util.ticksToSeconds(resumeTicks)), function () { play(false); }, 'primary'));
                    btns.push(ui.button('Play from start', function () { play(true); }));
                } else {
                    btns.push(ui.button('Play', function () { play(true); }, 'primary'));
                }
            }
            var watched = ui.button(item.UserData && item.UserData.Played ? 'Mark unwatched' : 'Mark watched', function () {
                var played = item.UserData && item.UserData.Played;
                var req = played
                    ? api.request('DELETE', '/UserPlayedItems/' + encodeURIComponent(item.Id), { userId: api.userId })
                    : api.markPlayed(item.Id);
                req.then(function (ud) {
                    item.UserData = ud || item.UserData;
                    app.dirty = true;
                    watched.textContent = item.UserData && item.UserData.Played ? 'Mark unwatched' : 'Mark watched';
                });
            });
            btns.push(watched);
            for (var i = 0; i < btns.length; i++) buttons.appendChild(btns[i]);
            s.content.appendChild(buttons);
            var rows = [{ items: btns }];

            if (item.Type === 'Series') {
                api.getSeasons(item.Id).then(function (seasons) {
                    if (!seasons.length) return;
                    var row = cardRow(api, 'Seasons', seasons, 'poster', function (season) {
                        JF.router.push(Season(app, item, season));
                    });
                    s.content.appendChild(row.el);
                    rows.push(row.focusRow);
                    focus.setRows(rows, focus.rowIndex);
                });
            } else if (item.Type === 'Episode' && item.SeriesId) {
                api.getEpisodes(item.SeriesId, item.SeasonId).then(function (eps) {
                    var row = cardRow(api, 'More from this season', eps, 'thumb', function (ep) {
                        JF.router.push(Details(app, ep));
                    });
                    for (var k = 0; k < eps.length; k++) if (eps[k].Id === item.Id) row.focusRow.index = k;
                    s.content.appendChild(row.el);
                    rows.push(row.focusRow);
                    focus.setRows(rows, focus.rowIndex);
                });
            }
            focus.setRows(rows, 0);
        }

        function load() {
            api.getItem(stub.Id).then(function (full) {
                item = full;
                render();
            }, function (err) {
                if (err && err.status === 401) { app.sessionExpired(); return; }
                util.clear(s.content);
                s.content.appendChild(message(errorText(err), true));
            });
        }

        var shown = false;
        return {
            el: s.el,
            focus: focus,
            onShow: function () {
                // Reload after playback so Resume shows the new position.
                if (!shown || app.dirty) load();
                shown = true;
            }
        };
    }

    function Season(app, series, season) {
        var api = app.api;
        var s = ui.screen('screen-season');
        var header = el('div', 'header');
        header.appendChild(el('div', 'header-title', series.Name + ' · ' + season.Name));
        s.el.insertBefore(header, s.content);
        var list = el('div', 'episode-list');
        s.content.appendChild(list);
        var focus = new JF.Focus(s.content);
        var loaded = false;

        function load() {
            api.getEpisodes(series.Id, season.Id).then(function (eps) {
                util.clear(list);
                var rows = [];
                var start = -1;
                for (var i = 0; i < eps.length; i++) {
                    var ep = eps[i];
                    var line = el('div', 'episode focusable');
                    var c = ui.card(api, ep, 'thumb');
                    c.className = c.className.replace(' focusable', '');
                    line.appendChild(c);
                    var text = el('div', 'episode-text');
                    text.appendChild(el('div', 'episode-title', (ep.IndexNumber !== undefined ? ep.IndexNumber + '. ' : '') + ep.Name));
                    var meta = [];
                    if (ep.RunTimeTicks) meta.push(util.formatRuntime(ep.RunTimeTicks));
                    if (ep.UserData && ep.UserData.Played) meta.push('Watched');
                    text.appendChild(el('div', 'episode-meta', meta.join(' · ')));
                    if (ep.Overview) text.appendChild(el('div', 'episode-overview', ep.Overview));
                    line.appendChild(text);
                    list.appendChild(line);
                    c.jfImage();
                    (function (ep) {
                        rows.push({ items: [line], onSelect: function () { JF.router.push(Details(app, ep)); } });
                    })(ep);
                    if (start === -1 && !(ep.UserData && ep.UserData.Played)) start = i;
                }
                // Start on the first unwatched episode.
                focus.setRows(rows, loaded ? focus.rowIndex : Math.max(0, start));
                loaded = true;
            }, function (err) {
                util.clear(list);
                list.appendChild(message(errorText(err), true));
            });
        }

        return {
            el: s.el,
            focus: focus,
            onShow: function () { if (!loaded || app.dirty) load(); }
        };
    }

    // ================================================================ settings

    var BITRATES = [
        { label: 'Auto (20 Mbps)', value: 20000000 },
        { label: '40 Mbps', value: 40000000 },
        { label: '60 Mbps', value: 60000000 },
        { label: '120 Mbps', value: 120000000 },
        { label: '10 Mbps', value: 10000000 },
        { label: '4 Mbps', value: 4000000 }
    ];

    function Settings(app) {
        var s = ui.screen('screen-settings');
        var header = el('div', 'header');
        header.appendChild(el('div', 'header-title', 'Settings'));
        s.el.insertBefore(header, s.content);
        var list = el('div', 'settings-list');
        s.content.appendChild(list);
        var focus = new JF.Focus(s.content);
        var settings = app.settings;

        function line(label, valueFn, onSelect) {
            var row = el('div', 'setting focusable');
            row.appendChild(el('div', 'setting-label', label));
            var v = el('div', 'setting-value', valueFn ? valueFn() : '');
            row.appendChild(v);
            row.jfSelect = function () {
                onSelect();
                if (valueFn) v.textContent = valueFn();
            };
            list.appendChild(row);
            return row;
        }

        /** On/Off for a codec the TV may only claim to play (see app.capabilities). */
        function capLine(label, cap) {
            return line(label, function () { return app.capabilities()[cap] ? 'On' : 'Off'; }, function () {
                settings.caps = util.extend({}, settings.caps);
                settings.caps[cap] = !app.capabilities()[cap];
                app.saveSettings();
            });
        }

        function bitrateLabel() {
            for (var i = 0; i < BITRATES.length; i++) if (BITRATES[i].value === settings.maxBitrate) return BITRATES[i].label;
            return Math.round(settings.maxBitrate / 1000000) + ' Mbps';
        }

        var rows = [
            line('Server', function () { return app.session.serverName + ' (' + app.session.server + ')'; }, function () {}),
            line('Signed in as', function () { return app.session.userName || ''; }, function () {}),
            line('Maximum streaming bitrate', bitrateLabel, function () {
                var i = 0;
                for (var k = 0; k < BITRATES.length; k++) if (BITRATES[k].value === settings.maxBitrate) i = k;
                settings.maxBitrate = BITRATES[(i + 1) % BITRATES.length].value;
                app.saveSettings();
            }),
            line('Skip forward / back', function () { return settings.skipForward + ' s / ' + settings.skipBack + ' s'; }, function () {
                var opts = [[30, 10], [10, 10], [60, 15], [15, 5]];
                var i = 0;
                for (var k = 0; k < opts.length; k++) if (opts[k][0] === settings.skipForward && opts[k][1] === settings.skipBack) i = k;
                var n = opts[(i + 1) % opts.length];
                settings.skipForward = n[0];
                settings.skipBack = n[1];
                app.saveSettings();
            }),
            line('Play next episode automatically', function () { return settings.autoplayNext ? 'On' : 'Off'; }, function () {
                settings.autoplayNext = !settings.autoplayNext;
                app.saveSettings();
            }),
            line('Debug log (blue key shows it)', function () { return settings.debug ? 'On' : 'Off'; }, function () {
                settings.debug = !settings.debug;
                app.saveSettings();
            }),
            line('Playback capabilities', function () { return app.capsSummary(); }, function () {}),
            capLine('HEVC direct play', 'hevc'),
            capLine('VP9 direct play', 'vp9'),
            line('Version', function () { return JF.version; }, function () {}),
            line('Sign out', null, function () { app.logout(); }),
            line('Change server', null, function () { app.logout(true); })
        ];

        var focusRows = [];
        for (var i = 0; i < rows.length; i++) focusRows.push({ items: [rows[i]] });
        return {
            el: s.el,
            focus: focus,
            onShow: function () { if (!focus.rows.length) focus.setRows(focusRows, 2); }
        };
    }

    return {
        Connect: Connect,
        Login: Login,
        Home: Home,
        Library: Library,
        Details: Details,
        Season: Season,
        Settings: Settings,
        errorText: errorText
    };
})();
