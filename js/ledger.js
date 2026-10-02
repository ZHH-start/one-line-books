/* 账本 md 解析 / 序列化 / 一致性校验 / 记录匹配 */
(function (ZH) {
    'use strict';
    var RE_REC = /^\d{4}-\d{2}-\d{2}\s*\|/;

    function splitCats(s) {
        return String(s || '').split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    function parseGoal(s) {
        var m = String(s || '').match(/([\d.]+)\s*\/?\s*(月|年)?/);
        if (!m || !m[1]) return null;
        return { amount: parseFloat(m[1]), period: m[2] === '年' ? 'year' : 'month' };
    }

    // 解析一条账本内的分类规则
    function parseRuleLine(line) {
        line = String(line || '').trim();
        if (!line) return null;
        line = line.replace(/^-\s*/, '');
        var sep = line.lastIndexOf(' - '); // 以 - 作为分隔符
        if (sep < 0) return null;
        var rule = line.slice(0, sep).trim();
        var category = line.slice(sep + 3).trim();
        if (!rule || !category) return null;
        return { rule: rule, category: category };
    }

    var Ledger = {
        parse: function (text) {
            text = text || '';
            var lines = text.split(/\r?\n/);
            var recStart = -1;
            for (var i = 0; i < lines.length; i++) {
                if (RE_REC.test(lines[i].trim())) { recStart = i; break; }
            }
            var headerLines = recStart < 0 ? lines.slice() : lines.slice(0, recStart);
            var recLines = recStart < 0 ? [] : lines.slice(recStart);
            var h = headerLines.filter(function (l) { return l.trim() !== '' && !/^-{2,}$/.test(l.trim()); });
            var header = { name: '', template: '', expenseCategories: [], incomeCategories: [], savingGoal: null, defaultRules: [], userRules: [] };
            var mode = null;

            // 解析账本头
            h.forEach(function (raw) {
                var line = raw.replace(/\s+$/, '');
                var m;
                if ((m = line.match(/^账本[:：]\s*(.*)$/))) { header.name = m[1].trim(); mode = null; return; }
                if ((m = line.match(/^模板[:：]\s*(.*)$/))) { header.template = m[1].trim(); mode = null; return; }
                if ((m = line.match(/^支出分类[:：]\s*(.*)$/))) { header.expenseCategories = splitCats(m[1]); mode = null; return; }
                if ((m = line.match(/^收入分类[:：]\s*(.*)$/))) { header.incomeCategories = splitCats(m[1]); mode = null; return; }
                if ((m = line.match(/^储蓄目标[:：]\s*(.*)$/))) { header.savingGoal = parseGoal(m[1]); mode = null; return; }

                // 解析分类规则
                if (/^默认分类规则[:：]?\s*$/.test(line)) { mode = 'default'; return; }
                if (/^用户分类规则[:：]?\s*$/.test(line)) { mode = 'user'; return; }
                if (mode === 'default' || mode === 'user') {
                    var r = parseRuleLine(line);
                    if (r) { (mode === 'user' ? header.userRules : header.defaultRules).push(r); return; }
                }
            });
            var records = []; var errors = [];
            recLines.forEach(function (raw, idx) {
                if (raw.trim() === '') return;
                var parts = raw.split('|');
                if (parts.length < 4) return;
                var date = parts[0].trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
                var type = parts[1].trim();
                var category = parts[2].trim();
                var amount = parseFloat(parts[3].trim());
                var note = (parts[4] || '').trim();
                var lineNo = recStart + idx + 1;
                if (type !== '收入' && type !== '支出') { errors.push({ line: lineNo, text: raw, reason: '类型非法' }); return; }
                if (isNaN(amount)) { errors.push({ line: lineNo, text: raw, reason: '金额无法解析' }); return; }
                var list = type === '收入' ? header.incomeCategories : header.expenseCategories;
                if (list.length && list.indexOf(category) < 0) { errors.push({ line: lineNo, text: raw, reason: '分类「' + category + '」未在账本头声明' }); return; }
                records.push({ date: date, type: type, category: category, amount: amount, note: note });
            });
            return { header: header, records: records, errors: errors };
        },

        serialize: function (header, records) {
            var L = [];
            L.push('-----------------');
            L.push('账本：' + (header.name || ''));
            if (header.template) L.push('模板：' + header.template);
            L.push('支出分类：' + (header.expenseCategories || []).join('、'));
            L.push('收入分类：' + (header.incomeCategories || []).join('、'));
            if (header.savingGoal && header.savingGoal.amount) { L.push('储蓄目标：' + header.savingGoal.amount + '/' + (header.savingGoal.period === 'year' ? '年' : '月')); }
            L.push('默认分类规则：');
            (header.defaultRules || []).forEach(function (r) { L.push('- ' + r.rule + ' - ' + r.category); });
            L.push('用户分类规则：');
            (header.userRules || []).forEach(function (r) { L.push('- ' + r.rule + ' - ' + r.category); });
            L.push('-----------------');
            L.push('');
            records.forEach(function (r) {
                L.push(r.date + ' | ' + r.type + ' | ' + r.category + ' | ' + ZH.util.fmt(r.amount) + ' | ' + (r.note || ''));
            });
            return L.join('\n');
        },

        match: function (a, b) {
            return a.date === b.date && a.type === b.type && a.category === b.category &&
                Math.abs(Number(a.amount) - Number(b.amount)) < 0.005 && (a.note || '') === (b.note || '');
        },

        splitCats: splitCats,
        parseRuleLine: parseRuleLine
    };

    ZH.ledger = Ledger;
})(window.ZH = window.ZH || {});
