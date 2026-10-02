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
        iosGuided: 'zh:iosGuided'
    };
    var Store = {
        get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
        set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { ZH.util.toast('存储失败：空间可能已满'); } },
        del: function (k) { try { localStorage.removeItem(k); } catch (e) { } },
        getText: function (k) { return localStorage.getItem(k); },
        setText: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { ZH.util.toast('存储失败'); } }
    };
    function persistStorage() {
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
    }
    ZH.store = { K: K, Store: Store, persistStorage: persistStorage };
})(window.ZH = window.ZH || {});
