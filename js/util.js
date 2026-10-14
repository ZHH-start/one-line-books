/* 通用工具：选择器、转义、格式化、日期、toast */
(function (ZH) {
    'use strict';
    var COLORS = ['#0a84ff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5ac8fa', '#ffcc00', '#ff2d55', '#30b0c7', '#8e8e93', '#a2845e', '#64d2ff'];

    function $(sel, root) { return (root || document).querySelector(sel); }
    function uuid() { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    var ESCMAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESCMAP[c]; }); }

    function fmt(n) { n = Number(n) || 0; return (Math.round(n * 100) / 100).toFixed(2); }
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    /* 统一使用设备本地时间 */
    function todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    function nowPrefix() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    // 文件名时间戳：YYYYMMDD_HHMMSS
    function fileStamp() {
        var d = new Date();
        return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    }
    function toast(msg) {
        var el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
        document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2200);
    }
    function colorAt(i) { return COLORS[i % COLORS.length]; }

    ZH.util = { $: $, uuid: uuid, esc: esc, fmt: fmt, todayStr: todayStr, nowPrefix: nowPrefix, fileStamp: fileStamp, toast: toast, colorAt: colorAt };
})(window.ZH = window.ZH || {});
