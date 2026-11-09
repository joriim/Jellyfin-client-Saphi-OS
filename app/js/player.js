/*
 * Video player screen: PlaybackInfo decision, <video> playback, on-screen
 * controls, progress reporting, resume, direct-play fallback to transcoding,
 * and the next episode.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
JF.Player = (function () {
    'use strict';

    var util = JF.util;
    var el = util.el;

    var PROGRESS_PLAYING_MS = 5000;
    var PROGRESS_PAUSED_MS = 15000;
    var OSD_HIDE_MS = 4000;
    var SEEK_COMMIT_MS = 800;

    /**
     * Chooses how to play a MediaSource from a PlaybackInfo answer.
     * Returns { url, method, offset } or null.
     *  - Direct play: the original file, seekable with currentTime.
     *  - Transcode/direct stream: the server's TranscodingUrl. For HLS the
     *    playlist covers the whole item; a progressive stream starts at the
     *    requested position, so `offset` is added to currentTime.
     */
    function choose(api, item, source, startSeconds, playSessionId) {
        if (!source) return null;
        if (source.SupportsDirectPlay && source.Protocol !== 'Http' && !source.IsRemote) {
            var params = {
                'static': true, mediaSourceId: source.Id, deviceId: api.deviceId,
                api_key: api.token, Tag: source.ETag, PlaySessionId: playSessionId
            };
            var container = source.Container ? '.' + source.Container.split(',')[0] : '';
            return {
                url: api.url('/Videos/' + encodeURIComponent(item.Id) + '/stream' + container, params),
                method: 'DirectPlay', offset: 0, hls: false
            };
        }
        if ((source.SupportsTranscoding || source.SupportsDirectStream) && source.TranscodingUrl) {
            var hls = source.TranscodingSubProtocol === 'hls' || /\.m3u8(\?|$)/.test(source.TranscodingUrl);
            var turl = api.server + source.TranscodingUrl;
            if (!/[?&](api_key|ApiKey)=/i.test(turl) && api.token) {
                turl += (turl.indexOf('?') === -1 ? '?' : '&') + 'api_key=' + encodeURIComponent(api.token);
            }
            return {
                url: turl,
                method: source.SupportsDirectStream && !source.SupportsTranscoding ? 'DirectStream' : 'Transcode',
                offset: hls ? 0 : startSeconds,
                hls: hls
            };
        }
        if (source.SupportsDirectPlay && source.Path && source.Protocol === 'Http') {
            return { url: source.Path, method: 'DirectPlay', offset: 0, hls: false };
        }
        return null;
    }

    function Player(app, item, opts) {
        opts = opts || {};
        var api = app.api;
        var settings = app.settings;

        var root = el('div', 'screen screen-player');
        var video = document.createElement('video');
        video.className = 'video';
        video.setAttribute('preload', 'auto');
        video.autoplay = true;
        root.appendChild(video);

        var osd = el('div', 'osd');
        var top = el('div', 'osd-top');
        var title = el('div', 'osd-title', item.Type === 'Episode' && item.SeriesName ? item.SeriesName : item.Name);
        var subtitle = el('div', 'osd-subtitle', item.Type === 'Episode' ? JF.ui.cardSubtitle(item) : (item.ProductionYear || ''));
        top.appendChild(title);
        top.appendChild(subtitle);
        var bottom = el('div', 'osd-bottom');
        var stateIcon = el('div', 'osd-state', '');
        var bar = el('div', 'osd-bar');
        var fill = el('div', 'osd-bar-fill');
        var seekMark = el('div', 'osd-bar-seek');
        bar.appendChild(fill);
        bar.appendChild(seekMark);
        var times = el('div', 'osd-times');
        var posText = el('span', 'osd-pos', '0:00');
        var durText = el('span', 'osd-dur', '');
        var methodText = el('span', 'osd-method', '');
        times.appendChild(posText);
        times.appendChild(methodText);
        times.appendChild(durText);
        bottom.appendChild(stateIcon);
        bottom.appendChild(bar);
        bottom.appendChild(times);
        osd.appendChild(top);
        osd.appendChild(bottom);
        root.appendChild(osd);
        var spinner = el('div', 'player-spinner', 'Loading…');
        root.appendChild(spinner);
        var errorBox = el('div', 'player-error');
        errorBox.style.display = 'none';
        root.appendChild(errorBox);

        var state = {
            playSessionId: null,
            mediaSourceId: null,
            method: null,
            offset: 0,
            hls: false,
            started: false,
            stopped: false,
            triedTranscode: false,
            audioIndex: undefined,
            subtitleIndex: undefined,
            pendingSeek: null,
            pendingStart: 0
        };
        var duration = util.ticksToSeconds(item.RunTimeTicks);
        var timers = { progress: null, osd: null, seek: null };

        function position() {
            if (state.pendingSeek !== null) return state.pendingSeek;
            return state.offset + (video.currentTime || 0);
        }

        function baseReport() {
            return {
                ItemId: item.Id,
                MediaSourceId: state.mediaSourceId,
                PlaySessionId: state.playSessionId,
                PlayMethod: state.method,
                PositionTicks: util.secondsToTicks(position()),
                IsPaused: video.paused,
                IsMuted: video.muted,
                AudioStreamIndex: state.audioIndex,
                SubtitleStreamIndex: state.subtitleIndex,
                CanSeek: true
            };
        }

        function scheduleProgress() {
            if (timers.progress) clearTimeout(timers.progress);
            if (state.stopped) return;
            timers.progress = setTimeout(function () {
                if (state.started && !state.stopped) api.reportProgress(baseReport()).then(null, function () {});
                scheduleProgress();
            }, video.paused ? PROGRESS_PAUSED_MS : PROGRESS_PLAYING_MS);
        }

        function showOsd(keep) {
            osd.className = 'osd visible';
            if (timers.osd) clearTimeout(timers.osd);
            if (!keep && !video.paused) {
                timers.osd = setTimeout(function () { osd.className = 'osd'; }, OSD_HIDE_MS);
            }
        }

        function updateOsd() {
            var pos = position();
            var dur = duration || (video.duration && isFinite(video.duration) ? video.duration + state.offset : 0);
            posText.textContent = util.formatTime(pos);
            durText.textContent = dur ? '-' + util.formatTime(Math.max(0, dur - pos)) : '';
            var pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
            if (state.pendingSeek !== null) {
                seekMark.style.display = 'block';
                seekMark.style.left = pct + '%';
            } else {
                seekMark.style.display = 'none';
                fill.style.width = pct + '%';
            }
            stateIcon.textContent = video.paused ? '❚❚' : '►';
        }

        function fail(text) {
            spinner.style.display = 'none';
            errorBox.style.display = 'block';
            errorBox.textContent = text + ' Press Back to return.';
            JF.log.error('playback failed:', text);
        }

        /** Asks the server how to play, from `startSeconds`, and starts it. */
        function load(startSeconds, forceTranscode) {
            spinner.style.display = 'block';
            errorBox.style.display = 'none';
            var profile = app.deviceProfile();
            var body = {
                DeviceProfile: profile,
                MaxStreamingBitrate: settings.maxBitrate,
                StartTimeTicks: util.secondsToTicks(startSeconds),
                AudioStreamIndex: state.audioIndex,
                SubtitleStreamIndex: state.subtitleIndex,
                MediaSourceId: state.mediaSourceId || undefined,
                EnableDirectPlay: !forceTranscode,
                EnableDirectStream: true,
                EnableTranscoding: true,
                AllowVideoStreamCopy: true,
                AllowAudioStreamCopy: true
            };
            return api.playbackInfo(item.Id, body).then(function (info) {
                if (state.stopped) return;
                if (info && info.ErrorCode) {
                    fail(info.ErrorCode === 'NotAllowed' ? 'You are not allowed to play this.' :
                        'The server cannot play this item (' + info.ErrorCode + ').');
                    return;
                }
                var sources = (info && info.MediaSources) || [];
                var source = sources[0];
                state.playSessionId = info.PlaySessionId;
                var choice = choose(api, item, source, startSeconds, info.PlaySessionId);
                if (!choice) {
                    fail('No playable stream for this item.');
                    return;
                }
                state.mediaSourceId = source.Id;
                if (state.audioIndex === undefined) state.audioIndex = source.DefaultAudioStreamIndex;
                if (state.subtitleIndex === undefined) state.subtitleIndex = source.DefaultSubtitleStreamIndex;
                state.method = choice.method;
                state.offset = choice.offset;
                state.hls = choice.hls;
                state.pendingStart = choice.offset ? 0 : startSeconds;
                methodText.textContent = choice.method === 'DirectPlay' ? 'Direct play' :
                    (choice.method === 'DirectStream' ? 'Direct stream' : 'Transcoding');
                JF.log.info('play', item.Name, choice.method, choice.url.replace(/api_key=[^&]+/, 'api_key=…'));
                video.src = choice.url;
                try { video.load(); } catch (e) { /* ignore */ }
                var p = video.play();
                if (p && p.then) p.then(null, function (e) { JF.log.warn('play() rejected', e && e.name); });
            }, function (err) {
                if (err && err.status === 401) { app.sessionExpired(); return; }
                fail(JF.screens.errorText(err));
            });
        }

        function stopEncoding() {
            if (state.method !== 'DirectPlay' && state.playSessionId) {
                return api.stopEncoding(state.playSessionId).then(null, function () {});
            }
            return JF.Promise.resolve();
        }

        /** Seeks to an absolute position (seconds). */
        function seekTo(seconds) {
            var dur = duration || 0;
            seconds = Math.max(0, dur ? Math.min(seconds, dur - 2) : seconds);
            if (state.method === 'DirectPlay' || state.hls) {
                video.currentTime = seconds - state.offset;
            } else {
                // A progressive transcode cannot seek: restart it there.
                stopEncoding().then(function () {
                    if (state.stopped) return;
                    load(seconds);
                });
            }
        }

        /** Arrow/FF/REW presses accumulate, then seek once. */
        function nudge(delta) {
            var base = state.pendingSeek !== null ? state.pendingSeek : position();
            state.pendingSeek = Math.max(0, duration ? Math.min(base + delta, duration - 2) : base + delta);
            updateOsd();
            showOsd(true);
            if (timers.seek) clearTimeout(timers.seek);
            timers.seek = setTimeout(function () {
                var target = state.pendingSeek;
                state.pendingSeek = null;
                seekTo(target);
                showOsd();
            }, SEEK_COMMIT_MS);
        }

        function togglePause() {
            if (video.paused) {
                var p = video.play();
                if (p && p.then) p.then(null, function () {});
            } else {
                video.pause();
            }
            showOsd(video.paused);
        }

        /** Ends playback and reports it. Resolves when reported. */
        function stop() {
            if (state.stopped) return JF.Promise.resolve();
            state.stopped = true;
            var report = baseReport();
            try { video.pause(); } catch (e) { /* ignore */ }
            video.removeAttribute('src');
            try { video.load(); } catch (e) { /* ignore */ }
            for (var k in timers) if (timers[k]) clearTimeout(timers[k]);
            app.dirty = true;
            var done = state.started ? api.reportStopped(report).then(null, function () {}) : JF.Promise.resolve();
            return done.then(stopEncoding);
        }

        function nextEpisode() {
            if (item.Type !== 'Episode' || !item.SeriesId || !settings.autoplayNext) return JF.Promise.resolve(null);
            return api.get('/Shows/' + encodeURIComponent(item.SeriesId) + '/Episodes', {
                userId: api.userId, startItemId: item.Id, limit: 2, fields: 'Overview'
            }).then(function (r) {
                var list = (r && r.Items) || [];
                return list.length > 1 && list[0].Id === item.Id ? list[1] : null;
            }, function () { return null; });
        }

        // ------------------------------------------------------------ events

        video.addEventListener('loadedmetadata', function () {
            if (state.pendingStart) {
                try { video.currentTime = state.pendingStart; } catch (e) { /* ignore */ }
                state.pendingStart = 0;
            }
        });
        video.addEventListener('playing', function () {
            spinner.style.display = 'none';
            if (!state.started) {
                state.started = true;
                api.reportStart(baseReport()).then(null, function () {});
                showOsd();
            } else {
                api.reportProgress(baseReport()).then(null, function () {});
            }
            scheduleProgress();
            updateOsd();
        });
        video.addEventListener('waiting', function () { spinner.style.display = 'block'; });
        video.addEventListener('pause', function () {
            if (state.stopped) return;
            if (state.started) api.reportProgress(baseReport()).then(null, function () {});
            scheduleProgress();
            updateOsd();
            showOsd(true);
        });
        video.addEventListener('timeupdate', updateOsd);
        video.addEventListener('ended', function () {
            var finished = item;
            stop().then(nextEpisode).then(function (next) {
                if (next) {
                    JF.ui.toast('Up next: ' + JF.ui.cardSubtitle(next));
                    app.play(next, { startTicks: 0, replace: true });
                } else if (JF.router.current() && JF.router.current().player === finished) {
                    JF.router.pop();
                }
            });
        });
        video.addEventListener('error', function () {
            if (state.stopped) return;
            var code = video.error ? video.error.code : 0;
            JF.log.warn('video error', code, state.method);
            if (state.method === 'DirectPlay' && !state.triedTranscode) {
                // The browser could not play the file after all: let the server
                // transcode it, from where we were.
                state.triedTranscode = true;
                JF.ui.toast('Cannot play this format directly. Transcoding…');
                load(position(), true);
            } else {
                fail('This video cannot be played (error ' + code + ').');
            }
        });

        // ------------------------------------------------------------ screen

        var screen = {
            el: root,
            player: item,
            onShow: function () {
                if (!state.playSessionId && !state.stopped) load(util.ticksToSeconds(opts.startTicks || 0));
            },
            destroy: function () { stop(); },
            onKey: function (action) {
                switch (action) {
                    case 'ok':
                    case 'playpause':
                        togglePause();
                        return true;
                    case 'play':
                        if (video.paused) togglePause();
                        return true;
                    case 'pause':
                        if (!video.paused) togglePause();
                        return true;
                    case 'left':
                    case 'rewind':
                        nudge(-settings.skipBack);
                        return true;
                    case 'right':
                    case 'forward':
                        nudge(settings.skipForward);
                        return true;
                    case 'up':
                    case 'down':
                    case 'info':
                        showOsd();
                        return true;
                    case 'stop':
                    case 'back':
                        if (osd.className.indexOf('visible') !== -1 && action === 'back' && !video.paused && state.started) {
                            osd.className = 'osd';
                            return true;
                        }
                        JF.router.pop();
                        return true;
                    case 'next':
                        stop().then(nextEpisode).then(function (next) {
                            if (next) app.play(next, { startTicks: 0, replace: true });
                            else JF.router.pop();
                        });
                        return true;
                }
                return false;
            },
            // For tests and the debug overlay.
            debugState: function () {
                return { method: state.method, position: position(), started: state.started, stopped: state.stopped, src: video.src };
            }
        };
        return screen;
    }

    Player.choose = choose;
    return Player;
})();
