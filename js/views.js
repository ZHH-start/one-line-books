/* 视图渲染：header / nav / 概览 / 记账 / 统计 / 明细 / 设置 / 弹层 */
(function (ZH) {
    'use strict';
    var U = ZH.util;

    function ico(n) {
        var p = {
            home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
            chat: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z',
            chart: 'M4 20h16M7 16V9m5 7V5m5 11v-4',
            list: 'M4 6h16M4 12h16M4 18h16',
            gear: 'M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zM19.4 13a7.9 7.9 0 0 0 0-2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.9 3h-3.8l-.4 2.6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.9 7.9 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.6h3.8l.4-2.6a8 8 0 0 0 1.7-1l2.4 1 2-3.4z',
            plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18'
        }[n] || '';
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + p + '"/></svg>';
    }

    function render() {
        var st = ZH.state;
        if (!st.ledger) { renderNoLedger(); return; }
        renderHeader(); renderNav();
        var main = U.$('#main');
        if (st.view === 'overview') main.innerHTML = viewOverview();
        else if (st.view === 'record') { main.innerHTML = ZH.chat.chatListView(); ZH.chat.mountChat(); }
        else if (st.view === 'stats') main.innerHTML = viewStats();
        else if (st.view === 'detail') main.innerHTML = viewDetail();
        else if (st.view === 'settings') main.innerHTML = viewSettings();
    }

    function renderNoLedger() {
        U.$('#hdr').innerHTML = '<div class="h-left"></div><div class="h-mid">一句话账本</div><div class="h-right"></div>';
        U.$('#nav').innerHTML = '';
        U.$('#main').innerHTML =
            '<div class="empty"><div style="font-size:40px">📒</div><p>还没有账本</p></div>' +
            '<div class="pad">' +
            '<button class="btn primary" style="width:100%;margin-bottom:10px" data-act="newLedger">新建账本</button>' +
            '<button class="btn" style="width:100%" data-act="importLedgerBtn">导入账本</button>' +
            '</div>';
    }

    function renderHeader() {
        var st = ZH.state;
        var t = { overview: '概览', record: '记账', stats: '统计', detail: '明细', settings: '设置' }[st.view] || '';
        var left = '';
        if (st.view === 'overview') {
            left = '<button class="btn" data-act="switchLedger" style="max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + U.esc(st.ledger.header.name) + ' ▾</button>';
        }
        U.$('#hdr').innerHTML = '<div class="h-left">' + left + '</div><div class="h-mid">' + t + '</div><div class="h-right"></div>';
    }

    function renderNav() {
        var st = ZH.state;
        var items = [['overview', '概览', 'home'], ['record', '记账', 'chat'], ['stats', '统计', 'chart'], ['detail', '明细', 'list'], ['settings', '设置', 'gear']];
        U.$('#nav').innerHTML = items.map(function (it) {
            return '<button data-act="nav" data-view="' + it[0] + '" class="' + (st.view === it[0] ? 'on' : '') + '">' + ico(it[2]) + '<span>' + it[1] + '</span></button>';
        }).join('');
    }

    function monthKey(d) { return d.slice(0, 7); }

    function viewOverview() {
        var st = ZH.state, S = ZH.store;
        var cur = U.todayStr().slice(0, 7), inc = 0, exp = 0;
        st.ledger.records.forEach(function (r) {
            if (monthKey(r.date) !== cur) return;
            if (r.type === '收入') inc += r.amount; else exp += r.amount;
        });
        var bal = inc - exp;
        var goal = st.ledger.header.savingGoal;
        var lastExp = st.currentId ? S.Store.get(S.K.lastExport(st.currentId), null) : null;
        var days = lastExp ? Math.floor((Date.now() - lastExp) / 86400000) : null;
        var h = '';
        h += '<div class="card">' +
            '<div class="between"><span class="sub">' + cur.replace('-', '年') + '月</span>' +
            '<button class="btn" data-act="editLedger">编辑账本</button></div>' +
            '<div class="grid3" style="margin-top:10px">' +
            '<div><div class="big">' + U.fmt(exp) + '</div><div class="sub">支出</div></div>' +
            '<div><div class="big">' + U.fmt(inc) + '</div><div class="sub">收入</div></div>' +
            '<div><div class="big ' + (bal >= 0 ? 'income' : 'expense') + '">' + U.fmt(bal) + '</div><div class="sub">结余</div></div>' +
            '</div></div>';
        h += '<div class="card"><div class="between"><span>本月储蓄目标</span><span class="sub">' + (goal && goal.amount ? U.fmt(goal.amount) + '/' + (goal.period === 'year' ? '年' : '月') : '未设置') + '</span></div>';
        if (goal && goal.amount) {
            var pct = Math.max(0, Math.min(100, Math.round((bal / goal.amount) * 100)));
            h += '<div class="progress" style="margin-top:8px"><i style="width:' + pct + '%"></i></div><div class="sub" style="margin-top:4px">已完成 ' + pct + '%</div>';
        }
        h += '<div style="margin-top:10px"><button class="btn" data-act="editGoal">设置储蓄目标</button></div></div>';
        if (days !== null && days > 10) {
            h += '<div class="card warn-card">距上次导出：' + days + ' 天，建议<a href="javascript:void(0)" data-act="exportFull">导出备份</a>。</div>';
        }
        return h;
    }

    function viewStats() {
        var st = ZH.state, mode = st.statMode;
        var h = '<div class="tabs">' + [['day', '日'], ['month', '月'], ['year', '年']].map(function (t) {
            return '<button class="' + (mode === t[0] ? 'on' : '') + '" data-act="statMode" data-mode="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div>';
        var buckets = {}, catExp = {}, catInc = {};
        st.ledger.records.forEach(function (r) {
            var key = r.date;
            if (mode === 'month') key = r.date.slice(0, 7);
            else if (mode === 'year') key = r.date.slice(0, 4);
            if (!buckets[key]) buckets[key] = { inc: 0, exp: 0 };
            if (r.type === '收入') { buckets[key].inc += r.amount; catInc[r.category] = (catInc[r.category] || 0) + r.amount; }
            else { buckets[key].exp += r.amount; catExp[r.category] = (catExp[r.category] || 0) + r.amount; }
        });
        var keys = Object.keys(buckets).sort();
        if (mode === 'day') keys = keys.slice(-31);
        else if (mode === 'month') keys = keys.slice(-12);
        else keys = keys.slice(-6);
        h += '<div class="card"><div class="between"><b>收支趋势</b><span class="sub">' + mode + '</span></div>';
        if (!keys.length) h += '<div class="empty">暂无数据</div>';
        else {
            h += ZH.charts.lineChart(keys.map(function (k) { return { label: k, inc: buckets[k].inc, exp: buckets[k].exp }; }));
            h += '<div class="legend"><span><i class="dot" style="background:var(--income)"></i>收入</span><span><i class="dot" style="background:var(--expense)"></i>支出</span></div>';
        }
        h += '</div>';
        var expSegs = Object.keys(catExp).map(function (k) { return { label: k, value: catExp[k] }; });
        var incSegs = Object.keys(catInc).map(function (k) { return { label: k, value: catInc[k] }; });
        h += '<div class="card"><b>支出分类占比</b>' + ZH.charts.pieBlock(expSegs) + '</div>';
        h += '<div class="card"><b>收入分类占比</b>' + ZH.charts.pieBlock(incSegs) + '</div>';
        return h;
    }

    function viewDetail() {
        var st = ZH.state;
        var recs = st.ledger.records.slice();
        if (st.detailMonth) recs = recs.filter(function (r) { return r.date.slice(0, 7) === st.detailMonth; });
        if (st.detailQuery) {
            var q = st.detailQuery.toLowerCase();
            recs = recs.filter(function (r) {
                return (r.note || '').toLowerCase().indexOf(q) >= 0 || r.category.toLowerCase().indexOf(q) >= 0 || U.fmt(r.amount).indexOf(q) >= 0;
            });
        }
        recs.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
        var h = '';
        h += '<div class="pad"><input id="searchInput" placeholder="搜索备注 / 分类 / 金额" value="' + U.esc(st.detailQuery) + '"></div>';
        h += '<div class="pad" style="padding-top:0"><input id="monthInput" type="month" value="' + U.esc(st.detailMonth) + '"></div>';
        if (!recs.length) { h += '<div class="empty">没有匹配的记录</div>'; return h; }
        var lastDate = '';
        recs.forEach(function (r) {
            if (r.date !== lastDate) { h += '<div class="daysep">' + r.date + '</div>'; lastDate = r.date; }
            var idx = st.ledger.records.indexOf(r);
            h += '<div class="rec" data-act="editRecord" data-idx="' + idx + '">' +
                '<div class="r-mid"><div>' + U.esc(r.category) + '</div><div class="r-note">' + U.esc(r.note || '') + '</div></div>' +
                '<div class="r-amt ' + (r.type === '收入' ? 'income' : 'expense') + '">' + (r.type === '收入' ? '+' : '-') + U.fmt(Math.abs(r.amount)) + '</div>' +
                '</div>';
        });
        return h;
    }

    function viewSettings() {
        var st = ZH.state, s = st.settings;
        var h = '';
        h += '<div class="card"><b>AI 配置</b>' +
            '<label class="f">API Base URL</label><input id="set_base" value="' + U.esc(s.apiBaseUrl) + '">' +
            '<label class="f">API Key</label><input id="set_key" type="password" value="' + U.esc(s.apiKey) + '">' +
            '<label class="f">模型名</label><input id="set_model" value="' + U.esc(s.model) + '">' +
            '<div style="margin-top:12px"><button class="btn primary" data-act="saveAIConfig">保存</button></div></div>';
        h += '<div class="card"><b>外观</b><div class="sub" style="margin-top:6px">主题模式</div><div class="theme-opts">' +
            [['system', '跟随系统'], ['light', '日间'], ['dark', '夜间']].map(function (t) {
                return '<button class="btn' + ((s.theme || 'system') === t[0] ? ' on' : '') + '" data-act="setTheme" data-theme="' + t[0] + '">' + t[1] + '</button>';
            }).join('') + '</div></div>';
        h += '<div class="card"><b>账本管理</b><div class="row" style="margin-top:10px;flex-wrap:wrap">' +
            '<button class="btn" data-act="newLedger">新建账本</button>' +
            '<button class="btn" data-act="editCategories">编辑分类表</button>' +
            '<button class="btn" data-act="mergeCategory">合并分类</button>' +
            '<button class="btn" data-act="editUserRules">自定义分类规则</button>' +
            '<button class="btn" data-act="importLedgerBtn">导入账本</button>' +
            '<button class="btn" data-act="exportFull">完整导出</button>' +
            '<button class="btn" data-act="openSplit">部分导出/拆分</button>' +
            '<button class="btn danger" data-act="deleteLedger" data-id="' + st.currentId + '">删除账本</button>' +
            '</div></div>';
        h += '<div class="card"><b>用户分类规则</b>' +
            (st.ledger.header.userRules.length ? st.ledger.header.userRules.map(function (r) { return '<div class="sub">• ' + U.esc(r.rule) + ' → ' + U.esc(r.category) + '</div>'; }).join('') : '<div class="sub">暂无</div>') +
            '</div>';
        // 缓存管理卡片：一键清空全部本地数据，点击二次确认
        h += '<div class="card"><b>缓存管理</b>' +
            '<div class="sub" style="margin-top:6px">清空将删除全部账本、对话记录、API 配置（含 Key）等本地数据，且不可恢复。建议先导出备份。</div>' +
            '<div style="margin-top:12px"><button class="btn danger" data-act="clearAll">清空所有缓存</button></div>' +
            '</div>';
        /* 设置最后一条：启动时自动更新开关 + 本版本更新内容。
           开关关闭 = 纯本地运行；打开时检查一次，若有更新则提示先备份、刷新即更新。 */
        h += '<div class="card"><b>更新</b>' +
            '<div class="between" style="margin-top:8px"><span>当前版本</span><span class="sub">' + U.esc(window.APP_VERSION) + '</span></div>' +
            '<div class="between" style="margin-top:8px"><span>启动时自动更新</span>' +
            '<button class="btn" data-act="toggleUpdate">' + (s.checkUpdate ? '已开启' : '已关闭') + '</button></div>' +
            '<div class="sub" style="margin-top:6px">关闭后 App 纯本地运行，不检查也不更新。</div>' +
            '<div style="margin-top:12px"><div class="sub"><b>本次版本更新内容（' + U.esc(window.APP_VERSION) + '）</b></div>' +
            '<div class="sub">' + U.esc(window.APP_NOTES || '无') + '</div></div>' +
            '</div>';
        return h;
    }

    /* ---------- Modals ---------- */
    function openModal(html) {
        U.$('#modal-root').innerHTML = '<div class="mask" data-act="closeModal"><div class="modal">' + html + '</div></div>';
    }
    function closeModal() { U.$('#modal-root').innerHTML = ''; }

    function modalNewLedger() {
        var opts = Object.keys(ZH.templates.TEMPLATES).map(function (k) { return '<option value="' + U.esc(k) + '">' + U.esc(k) + '</option>'; }).join('');
        openModal('<h3>新建账本</h3>' +
            '<label class="f">账本名</label><input id="nl_name" placeholder="例如：生活账本">' +
            '<label class="f">模板</label><select id="nl_tpl">' + opts + '</select>' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="doNewLedger">创建</button></div>');
    }
    function modalEditGoal() {
        var g = ZH.state.ledger.header.savingGoal || { amount: '', period: 'month' };
        openModal('<h3>本月储蓄目标</h3>' +
            '<label class="f">目标金额</label><input id="g_amt" type="number" inputmode="decimal" value="' + (g.amount || '') + '">' +
            '<label class="f">周期</label><select id="g_period"><option value="month"' + (g.period !== 'year' ? ' selected' : '') + '>每月</option><option value="year"' + (g.period === 'year' ? ' selected' : '') + '>每年</option></select>' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveGoal">保存</button></div>');
    }
    function modalEditCategories() {
        var he = ZH.state.ledger.header;
        openModal('<h3>编辑分类表</h3><p class="sub">移除仍有记录引用的分类会被拒绝；「其他」固定兜底。</p>' +
            '<label class="f">支出分类（用、分隔）</label><input id="c_exp" value="' + U.esc(he.expenseCategories.join('、')) + '">' +
            '<label class="f">收入分类（用、分隔）</label><input id="c_inc" value="' + U.esc(he.incomeCategories.join('、')) + '">' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveCategories">保存</button></div>');
    }
    function modalMergeCategory() {
        var cats = ZH.state.ledger.header.expenseCategories.concat(ZH.state.ledger.header.incomeCategories);
        var opts = cats.map(function (c) { return '<option value="' + U.esc(c) + '">' + U.esc(c) + '</option>'; }).join('');
        openModal('<h3>合并分类</h3><p class="sub">所有引用「来源」的记录将改写为「目标」，来源分类从账本头移除。</p>' +
            '<label class="f">来源分类</label><select id="mg_from">' + opts + '</select>' +
            '<label class="f">目标分类</label><select id="mg_to">' + opts + '</select>' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="doMergeCategory">确认合并</button></div>');
    }
    function modalEditUserRules() {
        var txt = ZH.state.ledger.header.userRules.map(function (r) { return r.rule + ' - ' + r.category; }).join('\n');
        openModal('<h3>自定义分类规则</h3><p class="sub">一行一条，格式：规则 - 分类。用户规则优先于默认规则。</p>' +
            '<textarea id="ur_text" placeholder="打气筒 - 购物">' + U.esc(txt) + '</textarea>' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveUserRules">保存</button></div>');
    }
    function modalSplit() {
        openModal('<h3>部分导出 / 拆分</h3><p class="sub">选中时间范围内的记录将从本账本移出。</p>' +
            '<label class="f">开始日期</label><input id="sp_from" type="date">' +
            '<label class="f">结束日期</label><input id="sp_to" type="date">' +
            '<label class="f">新账本名（可留空，默认=时间范围）</label><input id="sp_name">' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="doSplit">导出并移出</button></div>');
    }
    function modalSwitchLedger() {
        var st = ZH.state;
        var items = st.index.map(function (it) {
            return '<div class="rec" data-act="pickLedger" data-id="' + it.id + '"><div class="r-mid">' + U.esc(it.name) + (it.id === st.currentId ? ' <span class="sub">(当前)</span>' : '') + '</div></div>';
        }).join('');
        openModal('<h3>切换账本</h3>' + (items || '<div class="sub">无</div>') +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">关闭</button></div>');
    }
    function modalEditLedger() {
        openModal('<h3>编辑账本名</h3>' +
            '<label class="f">账本名</label><input id="el_name" value="' + U.esc(ZH.state.ledger.header.name) + '">' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveLedgerName">保存</button></div>');
    }
    function modalEditRecord(idx) {
        var r = ZH.state.ledger.records[idx]; if (!r) return;
        var cats = (r.type === '收入' ? ZH.state.ledger.header.incomeCategories : ZH.state.ledger.header.expenseCategories);
        var opts = cats.map(function (c) { return '<option' + (c === r.category ? ' selected' : '') + '>' + U.esc(c) + '</option>'; }).join('');
        openModal('<h3>编辑记录</h3>' +
            '<label class="f">日期</label><input id="r_date" type="date" value="' + U.esc(r.date) + '">' +
            '<label class="f">类型</label><select id="r_type"><option value="支出"' + (r.type === '支出' ? ' selected' : '') + '>支出</option><option value="收入"' + (r.type === '收入' ? ' selected' : '') + '>收入</option></select>' +
            '<label class="f">分类</label><select id="r_cat">' + opts + '</select>' +
            '<label class="f">金额</label><input id="r_amt" type="number" inputmode="decimal" value="' + U.esc(r.amount) + '">' +
            '<label class="f">备注</label><input id="r_note" value="' + U.esc(r.note || '') + '">' +
            '<div class="modal-actions"><button class="btn danger" data-act="delRecord" data-idx="' + idx + '">删除</button><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveRecord" data-idx="' + idx + '">保存</button></div>');
    }
    function modalRecordFromChat(rec) {
        var cats = (rec.type === '收入' ? ZH.state.ledger.header.incomeCategories : ZH.state.ledger.header.expenseCategories);
        var opts = cats.map(function (c) { return '<option' + (c === rec.category ? ' selected' : '') + '>' + U.esc(c) + '</option>'; }).join('');
        openModal('<h3>编辑记录</h3>' +
            '<label class="f">日期</label><input id="r_date" type="date" value="' + U.esc(rec.date) + '">' +
            '<label class="f">分类</label><select id="r_cat">' + opts + '</select>' +
            '<label class="f">金额</label><input id="r_amt" type="number" inputmode="decimal" value="' + U.esc(rec.amount) + '">' +
            '<label class="f">备注</label><input id="r_note" value="' + U.esc(rec.note || '') + '">' +
            '<input type="hidden" id="r_type" value="' + U.esc(rec.type) + '">' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn primary" data-act="saveChatRecord">保存</button></div>');
    }

    ZH.views = {
        ico: ico, render: render, renderNoLedger: renderNoLedger, renderHeader: renderHeader, renderNav: renderNav,
        viewOverview: viewOverview, viewStats: viewStats, viewDetail: viewDetail, viewSettings: viewSettings,
        openModal: openModal, closeModal: closeModal, modalNewLedger: modalNewLedger, modalEditGoal: modalEditGoal,
        modalEditCategories: modalEditCategories, modalMergeCategory: modalMergeCategory, modalEditUserRules: modalEditUserRules,
        modalEditLedger: modalEditLedger,
        modalSplit: modalSplit, modalSwitchLedger: modalSwitchLedger, modalEditRecord: modalEditRecord, modalRecordFromChat: modalRecordFromChat
    };
})(window.ZH = window.ZH || {});
