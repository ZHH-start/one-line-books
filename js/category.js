/* 分类增删合并、规则拼接 */
(function (ZH) {
    'use strict';
    var Category = {
        /* 新增分类：永远允许 */
        add: function (header, type, name) {
            name = (name || '').trim();
            if (!name) return false;
            var list = type === '收入' ? header.incomeCategories : header.expenseCategories;
            if (list.indexOf(name) >= 0) return false;
            /* 「其他」维持兜底末位 */
            if (name === '其他') return false;
            var otherIdx = list.indexOf('其他');
            if (otherIdx >= 0) list.splice(otherIdx, 0, name); else list.push(name);
            /* 确保末位为「其他」 */
            var oi = list.indexOf('其他');
            if (oi >= 0 && oi < list.length - 1) { list.splice(oi, 1); list.push('其他'); }
            return true;
        },

        /* 合并分类：A 并入 B，改写记录 + 头移除 A。返回改写记录数，-1 表示失败 */
        merge: function (ledger, from, to) {
            if (!from || !to || from === to) return -1;
            if (to === '其他') { /* 允许并入其他 */ }
            var header = ledger.header, records = ledger.records;
            var changed = 0;
            records.forEach(function (r) { if (r.category === from) { r.category = to; changed++; } });
            ['expenseCategories', 'incomeCategories'].forEach(function (k) {
                var i = header[k].indexOf(from);
                if (i >= 0) header[k].splice(i, 1);
            });
            return changed;
        },

        /* 删除分类：仅当无记录引用时允许 */
        canRemove: function (ledger, name) {
            return !ledger.records.some(function (r) { return r.category === name; });
        },
        countRefs: function (ledger, name) {
            return ledger.records.filter(function (r) { return r.category === name; }).length;
        },

        /* 拼接分类表与规则文本，供设置页/提示词复用 */
        ruleLines: function (header) {
            var lines = [];
            (header.defaultRules || []).forEach(function (r) { lines.push({ rule: r.rule, category: r.category, level: 'default' }); });
            (header.userRules || []).forEach(function (r) { lines.push({ rule: r.rule, category: r.category, level: 'user' }); });
            return lines;
        }
    };
    ZH.category = Category;
})(window.ZH = window.ZH || {});
