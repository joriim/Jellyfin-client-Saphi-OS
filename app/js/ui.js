/*
 * UI kit: logger, focus navigation, screen stack, cards, toasts.
 *
 * Focus works on rows, not on screen positions: a screen is a list of rows,
 * each row a list of focusable elements (or a grid with N columns). Left and
 * right move within a row, up and down move between rows, and each row
 * remembers its last index. This is predictable and cheap on a weak SoC.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
(function () {
    'use strict';

    var util = JF.util;
    var el = util.el;

    // ================================================================ log
    var LOG_LIMIT = 300;
    var buffer = [];
    var queue = [];
    var overlay = null;

    function stringify(a) {
        if (typeof a === 'string') return a;
        if (a && a.message) return (a.name || 'Error') + ': ' + a.message;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    }

    function write(level, args) {
        var parts = [];
        for (var i = 0; i < args.length; i++) parts.push(stringify(args[i]));
        var entry = { t: new Date().getTime(), level: level, msg: parts.join(' ') };
        buffer.push(entry);
        if (buffer.length > LOG_LIMIT) buffer.shift();
        if (JF.log.remote) {
            queue.push(entry);
            if (queue.length > LOG_LIMIT) queue.shift();
        }
        if (overlay && overlay.style.display === 'block') renderOverlay();
        if (window.console && window.console[level]) {
            try { window.console[level].apply(window.console, args); } catch (e) { /* ignore */ }
        }
    }

    function renderOverlay() {
        var lines = [];
        for (var i = Math.max(0, buffer.length - 30); i < buffer.length; i++) {
            lines.push('[' + buffer[i].level + '] ' + buffer[i].msg);
        }
        overlay.textContent = lines.join('\n');
    }

    JF.log = {
        remote: false,
        url: '/tv/log',
        debug: function () { write('debug', arguments); },
        info: function () { write('info', arguments); },
        warn: function () { write('warn', arguments); },
        error: function () { write('error', arguments); },
        entries: function () { return buffer.slice(); },
        flush: function () {
            if (!JF.log.remote || !queue.length) return;
            var batch = queue;
            queue = [];
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', JF.log.url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({ ua: navigator.userAgent, entries: batch }));
            } catch (e) { /* optional */ }
        },
        toggleOverlay: function () {
            if (!overlay) {
                overlay = el('pre', 'log-overlay');
                overlay.style.display = 'none';
                document.body.appendChild(overlay);
            }
            overlay.style.display = overlay.style.display === 'block' ? 'none' : 'block';
            if (overlay.style.display === 'block') renderOverlay();
        }
    };

    window.onerror = function (msg, src, line) {
        write('error', ['onerror', msg, (src || '') + ':' + (line || 0)]);
    };

    // ================================================================ focus

    /**
     * @param {Element} scroller element moved vertically to keep the focused
     *   row in view (usually the screen's content element), or null.
     */
    function Focus(scroller) {
        this.rows = [];
        this.rowIndex = 0;
        this.scroller = scroller || null;
        this.current = null;
    }

    /**
     * Row: { items: [Element], cols: N (grid) or 0, track: Element (moved
     * horizontally), index: start index, onSelect(i, el), onFocus(i, el),
     * onNearEnd() }
     */
    Focus.prototype.setRows = function (rows, rowIndex) {
        this.rows = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i].items && rows[i].items.length) {
                if (rows[i].index === undefined) rows[i].index = 0;
                this.rows.push(rows[i]);
            }
        }
        this.rowIndex = Math.min(rowIndex || 0, Math.max(0, this.rows.length - 1));
        this.apply();
    };

    Focus.prototype.row = function () { return this.rows[this.rowIndex] || null; };

    Focus.prototype.focusedElement = function () {
        var r = this.row();
        return r ? r.items[r.index] || null : null;
    };

    /** Moves focus to the element, if it is in one of the rows. */
    Focus.prototype.focusElement = function (target) {
        for (var r = 0; r < this.rows.length; r++) {
            var i = this.rows[r].items.indexOf(target);
            if (i !== -1) {
                this.rowIndex = r;
                this.rows[r].index = i;
                this.apply();
                return true;
            }
        }
        return false;
    };

    Focus.prototype.apply = function () {
        var target = this.focusedElement();
        if (this.current && this.current !== target) {
            this.current.className = this.current.className.replace(/\s*\bfocused\b/g, '');
            if (this.current === document.activeElement && this.current.blur) this.current.blur();
        }
        if (!target) { this.current = null; return; }
        if (!/\bfocused\b/.test(target.className)) target.className += ' focused';
        this.current = target;
        var row = this.row();
        this.scrollInto(row, target);
        if (row.onFocus) row.onFocus(row.index, target);
        if (row.onNearEnd && row.items.length - row.index <= Math.max(row.cols * 3, 6)) row.onNearEnd();
    };

    Focus.prototype.scrollInto = function (row, target) {
        // Horizontal rows keep the focused card at the left edge once the row
        // has scrolled, like the Android TV launcher.
        if (row.track && !row.cols) {
            var first = row.items[0];
            var x = target.offsetLeft - (first ? first.offsetLeft : 0);
            var maxX = Math.max(0, row.track.scrollWidth - (row.track.parentNode ? row.track.parentNode.clientWidth : 0));
            x = Math.max(0, Math.min(x, maxX + 40));
            row.track.style.transform = row.track.style.webkitTransform = 'translateX(' + (-x) + 'px)';
        }
        if (this.scroller) {
            var anchor = row.cols ? target : (row.anchor || target);
            var top = 0;
            var node = anchor;
            while (node && node !== this.scroller) { top += node.offsetTop; node = node.offsetParent; }
            // The first row keeps the screen at the top (titles, details).
            var y = this.rowIndex === 0 && !row.cols ? 0 : Math.max(0, top - (row.cols ? 260 : 140));
            this.scroller.style.transform = this.scroller.style.webkitTransform = 'translateY(' + (-y) + 'px)';
        }
    };

    /** Returns true when the key was used. */
    Focus.prototype.move = function (dir) {
        var row = this.row();
        if (!row) return false;
        var cols = row.cols || 0;
        var i = row.index;
        if (dir === 'left' || dir === 'right') {
            var step = dir === 'left' ? -1 : 1;
            if (cols && ((dir === 'left' && i % cols === 0) || (dir === 'right' && (i % cols === cols - 1)))) return false;
            if (i + step < 0 || i + step >= row.items.length) return false;
            row.index = i + step;
        } else if (dir === 'up' || dir === 'down') {
            if (cols) {
                var j = i + (dir === 'up' ? -cols : cols);
                if (j >= 0 && j < row.items.length) {
                    row.index = j;
                    this.apply();
                    return true;
                }
                if (dir === 'down' && Math.floor(i / cols) < Math.floor((row.items.length - 1) / cols)) {
                    row.index = row.items.length - 1; // last, shorter line
                    this.apply();
                    return true;
                }
            }
            var r = this.rowIndex + (dir === 'up' ? -1 : 1);
            if (r < 0 || r >= this.rows.length) return false;
            this.rowIndex = r;
        } else {
            return false;
        }
        this.apply();
        return true;
    };

    Focus.prototype.select = function () {
        var row = this.row();
        var target = this.focusedElement();
        if (!row || !target) return false;
        if (JF.platform.isTextField(target)) {
            target.focus();
            return true;
        }
        if (row.onSelect) row.onSelect(row.index, target);
        else if (target.jfSelect) target.jfSelect();
        return true;
    };

    JF.Focus = Focus;

    // ================================================================ router

    /**
     * Screen interface: { el, focus (JF.Focus), title, onKey(action) -> bool,
     * onShow(), onHide(), destroy() }. All optional except el.
     */
    JF.router = {
        stack: [],
        root: null,

        init: function (root) { this.root = root; },

        current: function () { return this.stack[this.stack.length - 1] || null; },

        push: function (screen) {
            var cur = this.current();
            if (cur) {
                if (cur.onHide) cur.onHide();
                cur.el.style.display = 'none';
            }
            this.stack.push(screen);
            this.root.appendChild(screen.el);
            if (screen.onShow) screen.onShow();
        },

        pop: function () {
            if (this.stack.length < 2) return false;
            var s = this.stack.pop();
            if (s.onHide) s.onHide();
            if (s.destroy) s.destroy();
            if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
            var cur = this.current();
            cur.el.style.display = '';
            if (cur.onShow) cur.onShow();
            if (cur.focus) cur.focus.apply();
            return true;
        },

        /** Replaces the whole stack with one screen (login -> home etc.). */
        reset: function (screen) {
            while (this.stack.length) {
                var s = this.stack.pop();
                if (s.onHide) s.onHide();
                if (s.destroy) s.destroy();
                if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
            }
            this.push(screen);
        }
    };

    // ================================================================ widgets

    var toastTimer = null;
    JF.ui = {
        toast: function (text, ms) {
            var t = document.getElementById('toast');
            if (!t) {
                t = el('div', 'toast');
                t.id = 'toast';
                (document.getElementById('app') || document.body).appendChild(t);
            }
            t.textContent = text;
            t.style.display = 'block';
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 3000);
        },

        button: function (label, onSelect, className) {
            var b = el('div', 'btn focusable' + (className ? ' ' + className : ''), label);
            b.jfSelect = onSelect;
            return b;
        },

        screen: function (className) {
            var s = el('div', 'screen ' + (className || ''));
            var content = el('div', 'screen-content');
            s.appendChild(content);
            return { el: s, content: content };
        },

        spinner: function (text) {
            return el('div', 'spinner', text || 'Loading…');
        },

        /** Sets an <img> source with a fade-in, hiding it if it fails. */
        setImage: function (img, src) {
            if (!src) return;
            img.onload = function () { img.className += ' loaded'; };
            img.onerror = function () { img.style.visibility = 'hidden'; };
            img.src = src;
        },

        /**
         * A card for an item. kind: 'poster' (2:3), 'thumb' (16:9), 'square'.
         * The image loads when reveal() is called, so long rows stay light.
         */
        card: function (api, item, kind) {
            var c = el('div', 'card card-' + kind + ' focusable');
            var frame = el('div', 'card-image');
            var img = el('img');
            img.alt = '';
            frame.appendChild(img);
            var w = kind === 'thumb' ? 400 : (kind === 'square' ? 280 : 220);
            var h = kind === 'thumb' ? 225 : (kind === 'square' ? 280 : 330);
            var src = null;
            if (kind === 'thumb') {
                src = api.imageUrl(item, 'Thumb', { width: w, height: h }) ||
                    api.imageUrl(item, 'Backdrop', { width: w, height: h }) ||
                    (item.Type === 'Episode' ? api.imageUrl({ Id: item.Id, ImageTags: item.ImageTags }, 'Primary', { width: w, height: h }) : null) ||
                    api.imageUrl(item, 'Primary', { width: w, height: h });
            } else {
                src = api.imageUrl(item, 'Primary', { width: w, height: h });
            }
            if (!src) frame.appendChild(el('div', 'card-fallback', item.Name || ''));
            c.jfImage = function () {
                if (src && !img.src) JF.ui.setImage(img, src);
            };
            var pct = item.UserData && item.UserData.PlayedPercentage;
            if (pct && pct > 0 && pct < 100) {
                var bar = el('div', 'card-progress');
                var fill = el('div', 'card-progress-fill');
                fill.style.width = Math.round(pct) + '%';
                bar.appendChild(fill);
                frame.appendChild(bar);
            }
            if (item.UserData && item.UserData.Played) frame.appendChild(el('div', 'card-badge', '✓'));
            else if (item.UserData && item.UserData.UnplayedItemCount) {
                frame.appendChild(el('div', 'card-badge', item.UserData.UnplayedItemCount));
            }
            c.appendChild(frame);
            c.appendChild(el('div', 'card-title', JF.ui.cardTitle(item)));
            var sub = JF.ui.cardSubtitle(item);
            if (sub) c.appendChild(el('div', 'card-subtitle', sub));
            c.jfItem = item;
            return c;
        },

        cardTitle: function (item) {
            if (item.Type === 'Episode' && item.SeriesName) return item.SeriesName;
            return item.Name || '';
        },

        cardSubtitle: function (item) {
            if (item.Type === 'Episode') {
                var se = (item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined)
                    ? 'S' + item.ParentIndexNumber + ':E' + item.IndexNumber + ' · ' : '';
                return se + (item.Name || '');
            }
            if (item.ProductionYear) return String(item.ProductionYear);
            return '';
        },

        /** Loads images for cards from..to in a list of card elements. */
        reveal: function (cards, from, to) {
            for (var i = Math.max(0, from); i < Math.min(cards.length, to); i++) {
                if (cards[i].jfImage) cards[i].jfImage();
            }
        }
    };
})();
