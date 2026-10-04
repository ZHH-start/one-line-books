/* localStorage 封装、键命名、持久化请求 */
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
    var Store = {
        get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
        set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { ZH.util.toast('存储失败：缓冲空间满'); return false; } },
        del: function (k) { try { localStorage.removeItem(k); } catch (e) { } },
        getText: function (k) { return localStorage.getItem(k); },
        setText: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { ZH.util.toast('存储失败'); return false; } }
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
        return ok;
    }
    ZH.store = { K: K, Store: Store, persistStorage: persistStorage, clearAll: clearAll };
})(window.ZH = window.ZH || {});
