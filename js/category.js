/* 分类增删合并、兜底项规整 */
(function (ZH) {
    'use strict';

    /* 兜底分类：每个表最后一项固定为兜底项，缺失时补上。
       收入模板历史上用「其他收入」，故两种写法都认，避免与既有记录冲突。 */
    var FALLBACK = { expense: ['其他'], income: ['其他收入', '其他'] };

    function ensureFallback(list, candidates) {
        var idx = -1;
        for (var i = 0; i < candidates.length; i++) {
            var j = list.indexOf(candidates[i]);
            if (j >= 0) { idx = j; break; }
        }
        if (idx < 0) { list.push(candidates[candidates.length - 1]); return; }
        if (idx < list.length - 1) list.push(list.splice(idx, 1)[0]); // 移到末位
    }

    /* 规整账本头：保证两个分类表都有兜底项且位于末位 */
    function normalize(header) {
        if (!header) return header;
        ensureFallback(header.expenseCategories, FALLBACK.expense);
        ensureFallback(header.incomeCategories, FALLBACK.income);
        return header;
    }

    var Category = {
        normalize: normalize,

        /* 合并分类：A 并入 B，改写记录 + 头移除 A。返回改写记录数，-1 表示失败 */
        merge: function (ledger, from, to) {
            if (!from || !to || from === to) return -1;
            var header = ledger.header, records = ledger.records;
            var changed = 0;
            records.forEach(function (r) { if (r.category === from) { r.category = to; changed++; } });
            ['expenseCategories', 'incomeCategories'].forEach(function (k) {
                var i = header[k].indexOf(from);
                if (i >= 0) header[k].splice(i, 1);
            });
            normalize(header); // 被合并掉的可能正是兜底项，补回
            return changed;
        },

        /* 删除分类：仅当无记录引用时允许 */
        canRemove: function (ledger, name) {
            return !ledger.records.some(function (r) { return r.category === name; });
        },
        countRefs: function (ledger, name) {
            return ledger.records.filter(function (r) { return r.category === name; }).length;
        }
    };
    ZH.category = Category;
})(window.ZH = window.ZH || {});
