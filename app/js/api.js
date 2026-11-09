/*
 * Jellyfin API client (Jellyfin 10.9+). XMLHttpRequest only: old engines may
 * have no fetch, and XHR gives timeouts and upload of JSON everywhere.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
JF.Api = (function () {
    'use strict';

    var P = JF.Promise;
    var util = JF.util;

    /** Fields requested for rows and grids: small, but enough for cards. */
    var CARD_FIELDS = 'PrimaryImageAspectRatio,ChildCount,ProductionYear,Overview';

    function ApiError(message, status, response) {
        this.name = 'ApiError';
        this.message = message;
        this.status = status || 0;
        this.response = response;
    }
    ApiError.prototype = new Error();

    /**
     * @param {object} opts server, token, userId, deviceId, deviceName,
     *   and optionally xhr (a factory, for tests) and timeout (ms).
     */
    function Api(opts) {
        this.server = (opts.server || '').replace(/\/+$/, '');
        this.token = opts.token || null;
        this.userId = opts.userId || null;
        this.deviceId = opts.deviceId;
        this.deviceName = opts.deviceName || 'Philips Saphi TV';
        this.timeout = opts.timeout || 20000;
        this.xhr = opts.xhr || function () { return new XMLHttpRequest(); };
    }

    function quote(v) {
        return String(v).replace(/"/g, "'");
    }

    Api.prototype.authHeader = function () {
        var h = 'MediaBrowser Client="' + quote(JF.clientName) + '", Device="' + quote(this.deviceName) +
            '", DeviceId="' + quote(this.deviceId) + '", Version="' + quote(JF.version) + '"';
        if (this.token) h += ', Token="' + quote(this.token) + '"';
        return h;
    };

    Api.prototype.url = function (path, params) {
        var q = params ? util.query(params) : '';
        return this.server + path + (q ? (path.indexOf('?') === -1 ? '?' : '&') + q : '');
    };

    /**
     * Sends a request. Resolves with parsed JSON (or null for an empty body);
     * rejects with an ApiError carrying the HTTP status (0 = network error).
     */
    Api.prototype.request = function (method, path, params, body) {
        var self = this;
        var url = this.url(path, params);
        return new P(function (resolve, reject) {
            var xhr = self.xhr();
            xhr.open(method, url, true);
            xhr.timeout = self.timeout;
            xhr.setRequestHeader('Authorization', self.authHeader());
            xhr.setRequestHeader('Accept', 'application/json');
            if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                var status = xhr.status;
                var data = null;
                var text = xhr.responseText;
                if (text) {
                    try { data = JSON.parse(text); } catch (e) { data = text; }
                }
                if (status >= 200 && status < 300) {
                    resolve(data);
                } else {
                    reject(new ApiError(method + ' ' + path + ' failed (' + (status || 'network error') + ')', status, data));
                }
            };
            xhr.ontimeout = function () {
                reject(new ApiError(method + ' ' + path + ' timed out', 0));
            };
            xhr.send(body !== undefined ? JSON.stringify(body) : null);
        });
    };

    Api.prototype.get = function (path, params) { return this.request('GET', path, params); };
    Api.prototype.post = function (path, params, body) {
        return this.request('POST', path, params, body === undefined ? {} : body);
    };

    // ------------------------------------------------------------ server

    /**
     * Addresses to try for what the user typed, most likely first.
     * "192.168.1.10" -> http://192.168.1.10:8096, https://192.168.1.10:8920,
     * http://192.168.1.10, https://192.168.1.10
     */
    Api.addressCandidates = function (input) {
        var s = String(input || '').replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
        if (!s) return [];
        var m = /^(https?:\/\/)?([^\/:]+|\[[^\]]+\])(:\d+)?(\/.*)?$/i.exec(s);
        if (!m) return [];
        var scheme = m[1] ? m[1].toLowerCase() : null;
        var host = m[2];
        var port = m[3] || '';
        var path = m[4] || '';
        var out = [];
        function add(u) { if (out.indexOf(u) === -1) out.push(u); }
        if (scheme && port) {
            add(scheme + host + port + path);
        } else if (scheme) {
            add(scheme + host + path);
            add(scheme + host + (scheme === 'https://' ? ':8920' : ':8096') + path);
        } else if (port) {
            add('http://' + host + port + path);
            add('https://' + host + port + path);
        } else {
            add('http://' + host + ':8096' + path);
            add('https://' + host + ':8920' + path);
            add('http://' + host + path);
            add('https://' + host + path);
        }
        return out;
    };

    /**
     * Finds a Jellyfin server for what the user typed. Resolves with
     * { address, info } for the first candidate that answers
     * /System/Info/Public like a Jellyfin server.
     */
    Api.findServer = function (input, opts) {
        var candidates = Api.addressCandidates(input);
        var i = 0;
        return new P(function (resolve, reject) {
            function next() {
                if (i >= candidates.length) {
                    reject(new ApiError('No Jellyfin server found at "' + input + '"', 0));
                    return;
                }
                var address = candidates[i++];
                var api = new Api(util.extend({}, opts, { server: address, timeout: 6000 }));
                api.get('/System/Info/Public').then(function (info) {
                    if (info && info.Id && (info.ProductName === undefined || /jellyfin/i.test(info.ProductName))) {
                        resolve({ address: address, info: info });
                    } else {
                        next();
                    }
                }, next);
            }
            next();
        });
    };

    // ------------------------------------------------------------ auth

    Api.prototype.setSession = function (auth) {
        this.token = auth.AccessToken;
        this.userId = auth.User && auth.User.Id;
    };

    Api.prototype.authenticateByName = function (username, password) {
        var self = this;
        return this.post('/Users/AuthenticateByName', null, { Username: username, Pw: password || '' })
            .then(function (auth) { self.setSession(auth); return auth; });
    };

    Api.prototype.quickConnectEnabled = function () {
        return this.get('/QuickConnect/Enabled').then(function (v) { return v === true; }, function () { return false; });
    };

    /** Resolves with { Secret, Code }. */
    Api.prototype.quickConnectInitiate = function () {
        return this.post('/QuickConnect/Initiate');
    };

    /** Resolves with true once the user has approved the code. */
    Api.prototype.quickConnectState = function (secret) {
        return this.get('/QuickConnect/Connect', { secret: secret }).then(function (r) { return !!(r && r.Authenticated); });
    };

    Api.prototype.authenticateWithQuickConnect = function (secret) {
        var self = this;
        return this.post('/Users/AuthenticateWithQuickConnect', null, { Secret: secret })
            .then(function (auth) { self.setSession(auth); return auth; });
    };

    Api.prototype.logout = function () {
        var p = this.token ? this.post('/Sessions/Logout').then(null, function () { return null; }) : P.resolve(null);
        this.token = null;
        this.userId = null;
        return p;
    };

    Api.prototype.currentUser = function () {
        return this.get('/Users/Me');
    };

    // ------------------------------------------------------------ browsing

    function items(r) { return (r && r.Items) || r || []; }

    Api.prototype.getViews = function () {
        return this.get('/UserViews', { userId: this.userId }).then(items);
    };

    Api.prototype.getResume = function (limit) {
        return this.get('/UserItems/Resume', {
            userId: this.userId, limit: limit || 24, mediaTypes: 'Video',
            fields: CARD_FIELDS, imageTypeLimit: 1, enableImageTypes: 'Primary,Backdrop,Thumb'
        }).then(items);
    };

    Api.prototype.getNextUp = function (limit) {
        return this.get('/Shows/NextUp', {
            userId: this.userId, limit: limit || 24, fields: CARD_FIELDS, imageTypeLimit: 1,
            enableImageTypes: 'Primary,Backdrop,Thumb', disableFirstEpisode: false
        }).then(items);
    };

    Api.prototype.getLatest = function (parentId, limit) {
        return this.get('/Items/Latest', {
            userId: this.userId, parentId: parentId, limit: limit || 24, fields: CARD_FIELDS,
            imageTypeLimit: 1, enableImageTypes: 'Primary,Backdrop,Thumb', groupItems: true
        }).then(items);
    };

    Api.prototype.getItem = function (id) {
        return this.get('/Items/' + encodeURIComponent(id), { userId: this.userId });
    };

    /** Resolves with { Items, TotalRecordCount }. */
    Api.prototype.getItems = function (params) {
        return this.get('/Items', util.extend({
            userId: this.userId, fields: CARD_FIELDS, imageTypeLimit: 1,
            enableImageTypes: 'Primary,Backdrop,Thumb'
        }, params));
    };

    Api.prototype.getSeasons = function (seriesId) {
        return this.get('/Shows/' + encodeURIComponent(seriesId) + '/Seasons', {
            userId: this.userId, fields: CARD_FIELDS
        }).then(items);
    };

    Api.prototype.getEpisodes = function (seriesId, seasonId) {
        return this.get('/Shows/' + encodeURIComponent(seriesId) + '/Episodes', {
            userId: this.userId, seasonId: seasonId, fields: CARD_FIELDS
        }).then(items);
    };

    /**
     * Image URL, or null when the item has no image of that type.
     * Falls back to the parent's or series' image for episodes and seasons.
     */
    Api.prototype.imageUrl = function (item, type, opts) {
        opts = opts || {};
        type = type || 'Primary';
        var id = item.Id;
        var tag = item.ImageTags && item.ImageTags[type];
        if (!tag && type === 'Backdrop' && item.BackdropImageTags && item.BackdropImageTags.length) {
            tag = item.BackdropImageTags[0];
        } else if (!tag && type === 'Backdrop' && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
            tag = item.ParentBackdropImageTags[0];
            id = item.ParentBackdropItemId;
        } else if (!tag && type === 'Thumb' && item.ParentThumbImageTag) {
            tag = item.ParentThumbImageTag;
            id = item.ParentThumbItemId;
        } else if (!tag && type === 'Primary' && item.SeriesPrimaryImageTag) {
            tag = item.SeriesPrimaryImageTag;
            id = item.SeriesId;
        }
        if (!tag || !id) return null;
        var path = '/Items/' + encodeURIComponent(id) + '/Images/' + type + (type === 'Backdrop' ? '/0' : '');
        return this.url(path, { fillWidth: opts.width, fillHeight: opts.height, quality: opts.quality || 80, tag: tag });
    };

    // ------------------------------------------------------------ playback

    Api.prototype.playbackInfo = function (itemId, body) {
        return this.post('/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', { userId: this.userId },
            util.extend({ UserId: this.userId, AutoOpenLiveStream: true }, body));
    };

    Api.prototype.reportStart = function (info) { return this.post('/Sessions/Playing', null, info); };
    Api.prototype.reportProgress = function (info) { return this.post('/Sessions/Playing/Progress', null, info); };
    Api.prototype.reportStopped = function (info) { return this.post('/Sessions/Playing/Stopped', null, info); };

    Api.prototype.stopEncoding = function (playSessionId) {
        return this.request('DELETE', '/Videos/ActiveEncodings', { deviceId: this.deviceId, playSessionId: playSessionId });
    };

    Api.prototype.markPlayed = function (itemId) {
        return this.post('/UserPlayedItems/' + encodeURIComponent(itemId), { userId: this.userId });
    };

    Api.ApiError = ApiError;
    return Api;
})();
