/* localStorage 封装、键命名、持久化请求、容量统计 */
(function (ZH) {
    'use strict';
    var K = {
        idx: 'zh:index',
        cur: 'zh:current',
        settings: 'zh:settings',
        ledger: function (id) { return 'zh:ledger:' + id; },
        chat: function (id) { return 'zh:chat:' + id; },
        pending: function (id) { return 'zh:pending:' + id; },
        lastExport: function (id) { return 'zh:lastExport:' + id; },
        iosGuided: 'zh:iosGuided',
        /* 升级状态自包含记录（升级判断的唯一依据，不依赖 HTTP 缓存时序）：
           { phase: 'pending', to, notes, from } —— 已决定升到 to，等待刷新后生效
           { phase: 'done', version, notes }     —— 当前页面即为 version */
        upgrade: 'zh:upgrade'
    };

    // 假定容量上限（UTF-16 单元数）：总量 默认4MB，单账本正文 默认800K
    var DEFAULT_CAP_UNITS = 4 * 1024 * 1024 / 2; // 4MB / 2 = 2,097,152 单元
    var DEFAULT_LEDGER_CAP_UNITS = 800 * 1024 / 2; // 800K / 2 = 409,600 单元
    var measureCache = null, measureAt = 0; // 测量结果缓存，避免每次渲染全量读键

    // 统计全部 zh:* 键占用（UTF-16 单元数），按账本正文/对话记录/核心配置/其它归类，并给出逐账本正文大小
    function measure() {
        if (measureCache && Date.now() - measureAt < 1500) return measureCache;
        var groups = { ledger: 0, chat: 0, config: 0, other: 0 };
        var ledgerSizes = {}; // 账本 id -> 正文占用单元数
        var total = 0, count = 0;
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf('zh:') !== 0) continue;
                var v = localStorage.getItem(k) || '';
                var units = k.length + v.length;
                total += units; count++;
                if (k.indexOf('zh:ledger:') === 0) {
                    groups.ledger += units;
                    ledgerSizes[k.slice('zh:ledger:'.length)] = units;
                }
                else if (k.indexOf('zh:chat:') === 0) groups.chat += units;
                else if (k === K.settings) groups.config += units;
                else groups.other += units;
            }
        } catch (e) { }
        measureCache = { total: total, count: count, groups: groups, ledgerSizes: ledgerSizes };
        measureAt = Date.now();
        return measureCache;
    }

    // 将 UTF-16 单元数格式化为可读字节串（每单元 2 字节）
    function fmtUnits(units) {
        var bytes = units * 2;
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    }

    // 写入失败提示：区分配额超限与其他错误
    function quotaMsg(e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
            return '存储空间已满：请导出账本并清理对话记录';
        }
        return '存储失败';
    }

    var Store = {
        get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
        set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); measureCache = null; return true; } catch (e) { ZH.util.toast(quotaMsg(e)); return false; } },
        del: function (k) { try { localStorage.removeItem(k); measureCache = null; } catch (e) { } },
        getText: function (k) { return localStorage.getItem(k); },
        setText: function (k, v) { try { localStorage.setItem(k, v); measureCache = null; return true; } catch (e) { ZH.util.toast(quotaMsg(e)); return false; } }
    };
    function persistStorage() {
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
    }

    // 清除本应用全部本地数据，返回是否成功
    function clearAll() {
        var ok = true;
        try {
            var keys = [], i;
            for (i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('zh:') === 0) keys.push(k); // 只收集本应用的键，避免误删同域其他数据
            }
            for (i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
        } catch (e) { ok = false; }
        measureCache = null;
        return ok;
    }
    ZH.store = { K: K, Store: Store, persistStorage: persistStorage, clearAll: clearAll, measure: measure, fmtUnits: fmtUnits, DEFAULT_CAP_UNITS: DEFAULT_CAP_UNITS, DEFAULT_LEDGER_CAP_UNITS: DEFAULT_LEDGER_CAP_UNITS };
})(window.ZH = window.ZH || {});
