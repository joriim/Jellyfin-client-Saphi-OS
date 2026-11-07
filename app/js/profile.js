/*
 * DeviceProfile builder. Tells the server what this browser can play, so the
 * server chooses direct play, remux or transcode. Capabilities come from the
 * <video> element's canPlayType (and MediaSource where it exists), and can be
 * overridden in settings once real test clips have been tried on the TV.
 *
 * Structure follows the Jellyfin DeviceProfile model as used by
 * jellyfin-androidtv and jellyfin-web; the code is our own.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
JF.profile = (function () {
    'use strict';

    var TYPES = {
        h264: 'video/mp4; codecs="avc1.640029"',
        hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
        hevcAlt: 'video/mp4; codecs="hev1.1.6.L120.90"',
        vp9: 'video/webm; codecs="vp9"',
        vp8: 'video/webm; codecs="vp8"',
        av1: 'video/mp4; codecs="av01.0.08M.08"',
        aac: 'audio/mp4; codecs="mp4a.40.2"',
        mp3: 'audio/mpeg',
        ac3: 'audio/mp4; codecs="ac-3"',
        eac3: 'audio/mp4; codecs="ec-3"',
        opus: 'audio/webm; codecs="opus"',
        vorbis: 'audio/webm; codecs="vorbis"',
        flac: 'audio/flac',
        mkv: 'video/x-matroska',
        ts: 'video/mp2t',
        hls: 'application/vnd.apple.mpegurl',
        hlsAlt: 'application/x-mpegURL'
    };

    function can(video, type) {
        try {
            var r = video.canPlayType(type);
            return r === 'probably' || r === 'maybe';
        } catch (e) {
            return false;
        }
    }

    /**
     * What this browser reports it can play. `video` is a <video> element
     * (or anything with canPlayType, for tests).
     */
    function detect(video) {
        var c = {};
        for (var k in TYPES) {
            if (Object.prototype.hasOwnProperty.call(TYPES, k)) c[k] = can(video, TYPES[k]);
        }
        c.hevc = c.hevc || c.hevcAlt;
        c.hls = c.hls || c.hlsAlt;
        return c;
    }

    function join(list) {
        var out = [];
        for (var i = 0; i < list.length; i++) if (list[i]) out.push(list[i]);
        return out.join(',');
    }

    /**
     * @param {object} caps from detect(), possibly edited by settings
     * @param {object} opts maxBitrate (bps), maxWidth, maxHeight, audioChannels
     */
    function build(caps, opts) {
        opts = opts || {};
        var maxBitrate = opts.maxBitrate || 20000000;
        var maxWidth = opts.maxWidth || 1920;
        var maxHeight = opts.maxHeight || 1080;
        var channels = String(opts.audioChannels || 6);

        var mp4Video = join([caps.h264 && 'h264', caps.hevc && 'hevc', caps.av1 && 'av1']);
        var mp4Audio = join([caps.aac && 'aac', caps.mp3 && 'mp3', caps.ac3 && 'ac3', caps.eac3 && 'eac3',
            caps.flac && 'flac', caps.opus && 'opus']);
        var webmVideo = join([caps.vp8 && 'vp8', caps.vp9 && 'vp9', caps.av1 && 'av1']);
        var webmAudio = join([caps.vorbis && 'vorbis', caps.opus && 'opus']);

        var direct = [];
        if (mp4Video) direct.push({ Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: mp4Video, AudioCodec: mp4Audio });
        if (caps.mkv && (mp4Video || webmVideo)) {
            direct.push({ Container: 'mkv', Type: 'Video', VideoCodec: join([mp4Video, webmVideo]), AudioCodec: join([mp4Audio, webmAudio]) });
        }
        if (webmVideo) direct.push({ Container: 'webm', Type: 'Video', VideoCodec: webmVideo, AudioCodec: webmAudio });
        if (caps.ts && caps.h264) direct.push({ Container: 'ts,mpegts', Type: 'Video', VideoCodec: mp4Video, AudioCodec: mp4Audio });
        if (caps.mp3) direct.push({ Container: 'mp3', Type: 'Audio' });
        if (caps.aac) direct.push({ Container: 'aac,m4a', Type: 'Audio', AudioCodec: 'aac' });
        if (caps.flac) direct.push({ Container: 'flac', Type: 'Audio' });

        // Transcoding target, best first. Native HLS is the cheapest for the
        // server (segments, seeking); otherwise a single progressive stream.
        var transcoding = [];
        var tVideo = caps.hevc && opts.transcodeHevc ? 'hevc,h264' : 'h264';
        var tAudio = join([caps.aac && 'aac', caps.ac3 && 'ac3', caps.mp3 && 'mp3']) || 'aac';
        if (caps.hls && caps.h264) {
            transcoding.push({
                Container: 'ts', Type: 'Video', Protocol: 'hls', Context: 'Streaming',
                VideoCodec: tVideo, AudioCodec: tAudio, MaxAudioChannels: channels,
                BreakOnNonKeyFrames: true, MinSegments: 1, CopyTimestamps: false
            });
        } else if (caps.ts && caps.h264) {
            transcoding.push({
                Container: 'ts', Type: 'Video', Protocol: 'http', Context: 'Streaming',
                VideoCodec: tVideo, AudioCodec: tAudio, MaxAudioChannels: channels
            });
        } else if (caps.h264) {
            transcoding.push({
                Container: 'mp4', Type: 'Video', Protocol: 'http', Context: 'Streaming',
                VideoCodec: 'h264', AudioCodec: tAudio, MaxAudioChannels: channels
            });
        } else if (caps.vp8 || caps.vp9) {
            // Open-source desktop Chromium (development) has no H.264.
            transcoding.push({
                Container: 'webm', Type: 'Video', Protocol: 'http', Context: 'Streaming',
                VideoCodec: caps.vp9 ? 'vp9' : 'vp8', AudioCodec: caps.opus ? 'opus' : 'vorbis', MaxAudioChannels: '2'
            });
        }
        transcoding.push({ Container: caps.mp3 ? 'mp3' : 'aac', Type: 'Audio', Protocol: 'http', Context: 'Streaming',
            AudioCodec: caps.mp3 ? 'mp3' : 'aac', MaxAudioChannels: '2' });

        var codec = [];
        if (caps.h264) {
            codec.push({
                Type: 'Video', Codec: 'h264',
                Conditions: [
                    { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline', IsRequired: false },
                    { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: String(opts.h264Level || 51), IsRequired: false },
                    { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
                    { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false }
                ]
            });
        }
        if (caps.hevc) {
            codec.push({
                Type: 'Video', Codec: 'hevc',
                Conditions: [
                    { Condition: 'EqualsAny', Property: 'VideoProfile', Value: opts.hevcMain10 === false ? 'main' : 'main|main 10', IsRequired: false }
                ]
            });
        }
        codec.push({
            Type: 'Video',
            Conditions: [
                { Condition: 'LessThanEqual', Property: 'Width', Value: String(maxWidth), IsRequired: false },
                { Condition: 'LessThanEqual', Property: 'Height', Value: String(maxHeight), IsRequired: false }
            ]
        });
        codec.push({
            Type: 'VideoAudio',
            Conditions: [{ Condition: 'LessThanEqual', Property: 'AudioChannels', Value: channels, IsRequired: false }]
        });

        return {
            Name: 'Jellyfin Saphi',
            MaxStreamingBitrate: maxBitrate,
            MaxStaticBitrate: Math.max(maxBitrate, 100000000),
            MusicStreamingTranscodingBitrate: 384000,
            DirectPlayProfiles: direct,
            TranscodingProfiles: transcoding,
            ContainerProfiles: [],
            CodecProfiles: codec,
            // Text subtitles come as WebVTT and are drawn by the player;
            // image subtitles (PGS, DVD, DVB) are burned in by the server.
            SubtitleProfiles: [
                { Format: 'vtt', Method: 'External' },
                { Format: 'vtt', Method: 'Hls' },
                { Format: 'pgssub', Method: 'Encode' },
                { Format: 'dvdsub', Method: 'Encode' },
                { Format: 'dvbsub', Method: 'Encode' }
            ],
            ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }]
        };
    }

    return { detect: detect, build: build, TYPES: TYPES };
})();
