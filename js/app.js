/* 主控：全局 state、账本管理、事件分发、版本检查、启动 */
(function (ZH) {
    'use strict';
    var U = ZH.util, S = ZH.store, L = ZH.ledger, V = ZH.views, IO = ZH.io;
    var K = S.K, Store = S.Store;

    var state = {
        index: [], currentId: null, ledger: null,
        settings: {}, chat: [], pending: [],
        view: 'overview', statRange: 'year', statOpen: null,
        detailQuery: '', detailMonth: '',
        chatBusy: null, chatAbort: null
    };
    ZH.state = state;

    function loadSettings() {
        state.settings = Store.get(K.settings, { apiBaseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', theme: 'system' });
        delete state.settings.checkUpdate; // 旧版「启动时自动更新」开关已移除，更新检查固定开启
        if (!state.settings.theme) state.settings.theme = 'system';
        if (!state.settings.storageCapUnits) state.settings.storageCapUnits = S.DEFAULT_CAP_UNITS; // 总量上限，默认 4MB
        if (!state.settings.ledgerCapUnits) state.settings.ledgerCapUnits = S.DEFAULT_LEDGER_CAP_UNITS; // 单账本名义上限，默认 800K
        if (state.settings.storageWarnPct == null) state.settings.storageWarnPct = 80; // 告警阈值百分比（0 或 100 表示关闭）
    }

    // 汇总缓存用量：总量占用与当前账本实际可增长上限
    function storageUsage() {
        var m = S.measure();
        var totalCap = state.settings.storageCapUnits || S.DEFAULT_CAP_UNITS; // 总量上限
        var ledgerCap = state.settings.ledgerCapUnits || S.DEFAULT_LEDGER_CAP_UNITS; // 单账本告警阈值，超此值提示
        var ledgerUsed = state.currentId ? (m.ledgerSizes[state.currentId] || 0) : 0; // 当前账本正文占用
        // 当前账本实际可增长上限：受总量剩余约束，取「阈值」与「已用+总量剩余」较小者
        var ledgerEffCap = Math.min(ledgerCap, ledgerUsed + (totalCap - m.total));
        if (ledgerEffCap < 1) ledgerEffCap = Math.max(ledgerUsed, 1); // 避免除零
        var totalPct = totalCap > 0 ? (m.total / totalCap) * 100 : 0;
        var ledgerPct = (ledgerUsed / ledgerEffCap) * 100;
        // 告警阈值：0 或 100 均视为关闭；仅 1-99 生效
        var warnPct = state.settings.storageWarnPct;
        if (warnPct == null) warnPct = 80;
        var warnActive = warnPct > 0 && warnPct < 100;
        return {
            m: m, totalCap: totalCap, totalPct: totalPct,
            ledgerCap: ledgerCap, ledgerEffCap: ledgerEffCap, ledgerUsed: ledgerUsed, ledgerPct: ledgerPct,
            warnPct: warnPct, warnActive: warnActive
        };
    }

    // 总量是否已达硬上限（>=4MB）：达到则阻断一切增长性写入
    function overQuota() { return storageUsage().totalPct >= 100; }

    // 写入闸门：允许写入返回 true，超总量硬上限返回 false 并提示
    function guardWrite() {
        if (overQuota()) { U.toast('总缓存已满，已暂停写入，请导出/拆分/清理后继续'); return false; }
        return true;
    }

    // 渲染全局告警条：总量与当前账本双条件，红黄两级，所有视图可见
    function renderWarnBar() {
        var bar = U.$('#warnbar'); if (!bar) return;
        var u = storageUsage();
        var lines = [];
        var exp = '<a href="javascript:void(0)" data-act="exportFull">导出账本</a>';
        var split = '<a href="javascript:void(0)" data-act="openSplit">拆分导出</a>';
        if (u.totalPct >= 100) lines.push(['danger', '⚠️ 总缓存已满，已暂停写入，请' + exp + '或清理对话记录后继续']);
        else if (u.warnActive && u.totalPct >= u.warnPct) lines.push(['warn', '⚠️ 总缓存已用 ' + u.totalPct.toFixed(0) + '%，建议' + exp + '并清理对话记录']);
        if (u.ledgerUsed > 0 && u.ledgerUsed >= u.ledgerEffCap) lines.push(['danger', '⚠️ 当前账本已超过允许使用容量，请' + split]);
        if (!lines.length) { bar.innerHTML = ''; bar.classList.add('hidden'); return; }
        bar.innerHTML = lines.map(function (l) { return '<div class="warnbar-inner ' + l[0] + '">' + l[1] + '</div>'; }).join('');
        bar.classList.remove('hidden');
    }
    function saveSettings() { Store.set(K.settings, state.settings); }
    function sortIndex() { state.index.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }); }
    function loadIndex() { state.index = Store.get(K.idx, []); sortIndex(); state.currentId = Store.get(K.cur, null); }
    function saveIndex() { sortIndex(); Store.set(K.idx, state.index); }
    function findIndexItem(id) { for (var i = 0; i < state.index.length; i++) if (state.index[i].id === id) return state.index[i]; return null; }

    // 切换账本前取消进行中的流式请求（标记为切换，不计入失败缓冲）
    function abortActiveRequest() {
        if (state.chatAbort) { try { state.chatAbort.__abortReason = 'switch'; state.chatAbort.abort('switch'); } catch (e) { } }
        state.chatAbort = null; state.chatBusy = null;
    }

    // 打开账本
    function openLedger(id) {
        abortActiveRequest();
        var text = Store.getText(K.ledger(id));
        if (text == null) { U.toast('账本不存在'); return; }
        var parsed = L.parse(text);
        if (parsed.errors.length) { showValidationErrors(parsed); return; }
        state.currentId = id; Store.set(K.cur, id);
        var item = findIndexItem(id); if (item) { item.updatedAt = Date.now(); saveIndex(); } // 最近使用置顶
        state.ledger = parsed;
        ZH.category.normalize(state.ledger.header);
        state.chat = Store.get(K.chat(id), []);
        state.pending = Store.get(K.pending(id), []);
        state.view = 'overview';
        render();
        if (state.pending.length) setTimeout(ZH.chat.askPending, 300);
    }
    function saveLedger() {
        if (!state.ledger || !state.currentId) return false;
        var text = L.serialize(state.ledger.header, state.ledger.records);
        var old = Store.getText(K.ledger(state.currentId));
        // 总量已达硬上限时阻断增长性写入；删除/缩减（更短）放行以便自救
        if (overQuota() && old != null && text.length >= old.length) {
            U.toast('总缓存已满，已暂停写入，请导出/拆分/清理后继续');
            return false;
        }
        Store.setText(K.ledger(state.currentId), text);
        var it = findIndexItem(state.currentId);
        if (it) { it.updatedAt = Date.now(); saveIndex(); }
        return true;
    }
    function saveChat() { if (state.currentId && guardWrite()) Store.set(K.chat(state.currentId), state.chat); }
    function savePending() { if (state.currentId && guardWrite()) Store.set(K.pending(state.currentId), state.pending); }

    function showValidationErrors(parsed) {
        var html = '<h3>账本损坏。</h3><p class="sub">以下记录引用了账本头未声明的分类，请修正后使用。</p>';
        parsed.errors.forEach(function (e) { html += '<div class="sub" style="margin:8px 0">第 ' + e.line + ' 行：' + U.esc(e.text) + '<br>— ' + U.esc(e.reason) + '</div>'; });
        html += '<div class="modal-actions"><button class="btn" data-act="closeModal">关闭</button></div>';
        V.openModal(html);
    }

    // 账本配置
    function createLedger(name, templateKey) {
        name = (name || '').trim();
        if (!name) { U.toast('请输入账本名'); return; }
        if (!guardWrite()) return; // 总量已满时不允许新建
        if (state.index.some(function (x) { return x.name === name; })) { U.toast('已存在同名账本'); return; }
        var tpl = ZH.templates.TEMPLATES[templateKey] || ZH.templates.TEMPLATES['生活'];
        var header = {
            name: name, template: templateKey || '生活',
            expenseCategories: tpl.expense.slice(), incomeCategories: tpl.income.slice(),
            savingGoal: null, defaultRules: tpl.defaultRules.slice(), userRules: []
        };
        var id = U.uuid();
        Store.setText(K.ledger(id), L.serialize(header, []));
        state.index.push({ id: id, name: name, template: header.template, updatedAt: Date.now() });
        saveIndex(); openLedger(id);
    }

    function deleteLedger(id) {
        var it = findIndexItem(id); if (!it) return;
        var recCount = 0, txt = Store.getText(K.ledger(id));
        if (txt) recCount = L.parse(txt).records.length;
        var html = '<h3>删除账本</h3><p class="sub">将删除账本「' + U.esc(it.name) + '」（' + recCount + ' 条记录）。建议先导出备份。</p>' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button><button class="btn danger" data-act="doDeleteLedger" data-id="' + id + '">确认删除</button></div>';
        V.openModal(html);
    }

    // 删除账本
    function doDeleteLedger(id) {
        abortActiveRequest();
        /* 级联清除全部附属键，避免孤儿数据 */
        Store.del(K.ledger(id)); Store.del(K.chat(id)); Store.del(K.pending(id)); Store.del(K.lastExport(id));
        state.index = state.index.filter(function (x) { return x.id !== id; });
        saveIndex();
        if (state.currentId === id) {
            state.currentId = null; Store.del(K.cur);
            state.ledger = null; state.chat = []; state.pending = [];
            if (state.index.length) { openLedger(state.index[0].id); return; }
        }
        V.closeModal(); render();
    }

    /* 升级完成后若存在「待处理输入」，等升级提示关闭再询问，避免两个弹窗互相覆盖 */
    var pendingAfterUpgrade = false;
    // 事件分发回调-业务动作
    function closeModalAct(el, e) {
        // 点击蒙层内部时冒泡到 mask，不应关闭；点蒙层空白处或关闭按钮才关
        if (el.classList.contains('mask') && e.target !== el) return;
        V.closeModal();
        if (pendingAfterUpgrade) { pendingAfterUpgrade = false; setTimeout(ZH.chat.askPending, 60); }
    }
    function saveGoal() {
        var amt = parseFloat(U.$('#g_amt').value);
        if (isNaN(amt) || amt <= 0) state.ledger.header.savingGoal = null;
        else state.ledger.header.savingGoal = { amount: Math.round(amt * 100) / 100, period: U.$('#g_period').value === 'year' ? 'year' : 'month' };
        saveLedger(); V.closeModal(); render();
    }
    function saveCategories() {
        var exp = L.splitCats(U.$('#c_exp').value), inc = L.splitCats(U.$('#c_inc').value);
        // 被移除的分类若有记录引用则拒绝保存
        var next = exp.concat(inc);
        var removed = state.ledger.header.expenseCategories.concat(state.ledger.header.incomeCategories).filter(function (c) {
            return next.indexOf(c) < 0 && !ZH.category.canRemove(state.ledger, c);
        });
        if (removed.length) { U.toast('分类「' + removed.join('、') + '」仍有记录引用，请先处理'); return; }
        state.ledger.header.expenseCategories = exp; state.ledger.header.incomeCategories = inc;
        ZH.category.normalize(state.ledger.header); // 补回/移到末位的兜底项
        saveLedger(); V.closeModal(); render();
    }
    function doMergeCategory() {
        var from = U.$('#mg_from').value, to = U.$('#mg_to').value;
        if (from === to) { U.toast('来源与目标不能相同'); return; }
        var cnt = ZH.category.countRefs(state.ledger, from);
        // merge 返回 -1 表示跨收支表等非法合并，拒绝执行
        if (ZH.category.merge(state.ledger, from, to) < 0) { U.toast('来源与目标必须属于同一收支类型'); return; }
        saveLedger(); V.closeModal(); render();
        U.toast('已合并「' + from + '」→「' + to + '」，改写 ' + cnt + ' 条');
    }
    function saveUserRules() {
        state.ledger.header.userRules = U.$('#ur_text').value.split(/\n/).map(L.parseRuleLine).filter(Boolean);
        saveLedger(); V.closeModal(); render();
    }
    function doSplit() {
        var from = U.$('#sp_from').value, to = U.$('#sp_to').value, name = U.$('#sp_name').value;
        if (!from || !to) { U.toast('请选择时间范围'); return; }
        if (from > to) { U.toast('开始日期不能晚于结束日期'); return; }
        IO.splitExport(from, to, name);
    }
    function saveRecord(el) {
        var r = state.ledger.records[parseInt(el.getAttribute('data-idx'), 10)];
        if (!r) return;
        var type = U.$('#r_type').value, category = U.$('#r_cat').value;
        // 类型与分类必须属于同一张分类表，避免写入「收入+支出分类」这类错配记录
        var list = type === '收入' ? state.ledger.header.incomeCategories : state.ledger.header.expenseCategories;
        if (list.indexOf(category) < 0) { U.toast('分类与类型不匹配，请重新选择分类'); return; }
        r.date = U.$('#r_date').value; r.type = type;
        r.category = category; r.note = U.$('#r_note').value;
        r.amount = Math.round(parseFloat(U.$('#r_amt').value) * 100) / 100 || 0;
        saveLedger(); V.closeModal(); render();
    }
    function delRecord(el) {
        state.ledger.records.splice(parseInt(el.getAttribute('data-idx'), 10), 1);
        saveLedger(); V.closeModal(); render();
    }
    function editChip(el) {
        try { V.modalRecordFromChat(JSON.parse(decodeURIComponent(el.getAttribute('data-rec')))); } catch (err) { }
    }
    function saveChatRecord() {
        var rec = {
            date: U.$('#r_date').value, type: U.$('#r_type').value, category: U.$('#r_cat').value,
            amount: Math.round(parseFloat(U.$('#r_amt').value) * 100) / 100 || 0, note: U.$('#r_note').value
        };
        for (var i = 0; i < state.ledger.records.length; i++) {
            if (L.match(state.ledger.records[i], rec)) {
                state.ledger.records[i] = rec; saveLedger(); V.closeModal(); render(); return;
            }
        }
        U.toast('原记录已变动，请在明细页编辑'); V.closeModal();
    }
    function editLedger() { V.modalEditLedger(); }
    function saveLedgerName() {
        var name = U.$('#el_name').value.trim();
        if (!name) { U.toast('请输入账本名'); return; }
        if (state.index.some(function (x) { return x.name === name && x.id !== state.currentId; })) { U.toast('已存在同名账本'); return; }
        state.ledger.header.name = name;
        var it = findIndexItem(state.currentId); if (it) it.name = name;
        saveLedger(); V.closeModal(); render();
    }
    function saveAIConfig() {
        state.settings.apiBaseUrl = U.$('#set_base').value.trim();
        state.settings.apiKey = U.$('#set_key').value.trim();
        state.settings.model = U.$('#set_model').value.trim();
        saveSettings(); U.toast('已保存');
    }
    // 是否为整数
    function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

    // 保存缓存总量上限（MB）、单账本上限（KB）与告警阈值（%）
    // 约束：三项均为整数；总量 1-4MB；单账本 <= 总量；告警阈值 0-100（0 或 100 视为关闭）
    function saveStorageCfg() {
        var mb = parseFloat(U.$('#sc_cap').value); // 总量上限，单位 MB
        var kb = parseFloat(U.$('#sc_ledger').value); // 单账本上限，单位 KB
        var pct = parseFloat(U.$('#sc_warn').value); // 告警阈值百分比
        if (isNaN(mb) || !isInt(mb) || mb < 1 || mb > 4) { U.toast('总量上限须为 1-4 的整数（MB）'); return; }
        if (isNaN(kb) || !isInt(kb) || kb < 1) { U.toast('单账本上限须为不小于 1 的整数（KB）'); return; }
        if (kb > mb * 1024) { U.toast('单账本上限不得大于总量上限'); return; }
        if (isNaN(pct) || !isInt(pct) || pct < 0 || pct > 100) { U.toast('告警阈值须为 0-100 的整数'); return; }
        state.settings.storageCapUnits = Math.round(mb * 1024 * 1024 / 2);
        state.settings.ledgerCapUnits = Math.round(kb * 1024 / 2);
        state.settings.storageWarnPct = pct; // 0 或 100 表示关闭告警
        saveSettings(); V.closeModal(); render();
        U.toast('已保存');
    }

    // 清空所有缓存的二次确认弹窗
    function confirmClearAll() {
        V.openModal('<h3>清空所有缓存</h3>' +
            '<p class="sub">将删除全部账本、对话记录、API 配置（含 Key）及所有本地设置，<b>且不可恢复</b>。建议先导出备份。</p>' +
            '<p class="sub">确定要清空所有缓存吗？</p>' +
            '<div class="modal-actions"><button class="btn" data-act="closeModal">取消</button>' +
            '<button class="btn danger" data-act="doClearAll">确认清空</button></div>');
    }

    // 执行清空并回到无账本态
    function doClearAll() {
        abortActiveRequest(); // 中断进行中的 AI 请求
        if (!S.clearAll()) { U.toast('清空失败，请重试'); return; }
        state.index = []; state.currentId = null; state.ledger = null; // 重置内存状态
        state.chat = []; state.pending = []; state.view = 'overview';
        loadSettings(); applyTheme(); // 重新载入默认配置并应用主题
        V.closeModal(); render();
        U.toast('已清空所有缓存');
    }
    // 事件分发回调对应表
    var ACTIONS = {
        closeModal: closeModalAct,
        nav: function (el) { state.view = el.getAttribute('data-view'); render(); },
        switchLedger: function () { V.modalSwitchLedger(); },
        pickLedger: function (el) { openLedger(el.getAttribute('data-id')); V.closeModal(); },
        newLedger: function () { V.modalNewLedger(); },
        doNewLedger: function () { createLedger(U.$('#nl_name').value, U.$('#nl_tpl').value); V.closeModal(); },
        deleteLedger: function (el) { deleteLedger(el.getAttribute('data-id')); },
        doDeleteLedger: function (el) { doDeleteLedger(el.getAttribute('data-id')); },
        importLedgerBtn: function () { V.closeModal(); IO.pickFile(); },
        editGoal: function () { V.modalEditGoal(); },
        saveGoal: saveGoal,
        editCategories: function () { V.modalEditCategories(); },
        saveCategories: saveCategories,
        mergeCategory: function () { V.modalMergeCategory(); },
        doMergeCategory: doMergeCategory,
        editUserRules: function () { V.modalEditUserRules(); },
        saveUserRules: saveUserRules,
        exportFull: function () { V.closeModal(); IO.exportFull(); },
        openSplit: function () { V.modalSplit(); },
        doSplit: doSplit,
        editLedger: editLedger,
        saveLedgerName: saveLedgerName,
        editRecord: function (el) { V.modalEditRecord(parseInt(el.getAttribute('data-idx'), 10)); },
        saveRecord: saveRecord,
        delRecord: delRecord,
        editChip: editChip,
        saveChatRecord: saveChatRecord,
        saveAIConfig: saveAIConfig,
        clearAll: confirmClearAll,
        doClearAll: doClearAll,
        editStorageCfg: function () { V.modalStorageCfg(); },
        saveStorageCfg: saveStorageCfg,
        send: function () { ZH.chat.handleSend(); },
        chatSend: function () { if (state.chatBusy) ZH.chat.stopRequest(); else ZH.chat.handleSend(); },
        userMsg: function (el) { ZH.chat.askDeleteUserMsg(el); },
        doDeleteUserMsg: function (el) { ZH.chat.doDeleteUserMsg(el); },
        setTheme: setTheme,
        statRange: function (el) {
            state.statRange = el.getAttribute('data-range');
            state.statOpen = null;
            renderKeepScroll();
        },
        statToggle: function (el) {
            var key = el.getAttribute('data-type') + ':' + el.getAttribute('data-cat');
            state.statOpen = state.statOpen === key ? null : key;
            renderKeepScroll();
        },
        pendingResend: function () { ZH.chat.resendPending(); },
        pendingDiscard: function () { ZH.chat.discardPending(); },
    };

    // 点击行为触发事件 事件分发器
    function handleClick(e) {
        var el = e.target.closest('[data-act]');
        if (!el) return;
        var fn = ACTIONS[el.getAttribute('data-act')];
        if (fn) fn(el, e);
    }

    // 统计页切换范围/展开分类时保留 main 的滚动位置
    function renderKeepScroll() {
        var m = U.$('#main'), top = m ? m.scrollTop : 0;
        render();
        if (m) m.scrollTop = top;
    }

    /* ---------- 主题模式 ---------- */
    function themeMedia() { return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null; }
    function effectiveTheme() {
        var t = state.settings.theme || 'system';
        if (t === 'system') { var m = themeMedia(); return (m && m.matches) ? 'dark' : 'light'; }
        return t;
    }
    function applyTheme() {
        var dark = effectiveTheme() === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        var tc = document.querySelector('meta[name="theme-color"]');
        if (tc) tc.setAttribute('content', dark ? '#000000' : '#ffffff');
    }
    function setTheme(el) {
        state.settings.theme = el.getAttribute('data-theme') || 'system';
        saveSettings(); applyTheme(); render();
    }
    function onSystemThemeChange() { if ((state.settings.theme || 'system') === 'system') applyTheme(); }

    /* ---------- 版本检查与自动升级 ---------- */
    // 按数字段比较版本号（1.10.0 > 1.9.0）；缺失段按 0 处理
    function compareVersion(a, b) {
        function parts(v) {
            return String(v == null ? '' : v).split(/[^0-9]+/).filter(Boolean).map(function (n) {
                return parseInt(n, 10) || 0;
            });
        }
        var pa = parts(a), pb = parts(b), n = Math.max(pa.length, pb.length);
        for (var i = 0; i < n; i++) {
            var x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }

    /* 升级提示结算：
       - 仅当「当前实际加载的版本」比「已提示过的版本」更新时才提示；
       - 加载到旧缓存（版本倒退，如残留 Service Worker/HTTP 旧副本）时既不提示，
         也不把标记改回旧值，否则新旧代码交替加载会反复弹窗；
       - 首次安装或标记缺失时静默记录当前版本。 */
    function settleVersionNotice() {
        var previous = Store.get(K.versionNotice, null);
        var legacy = Store.get(K.upgrade, null);
        var hasPrevious = typeof previous === 'string' && previous !== '';
        var shouldShow = false;

        if (hasPrevious) {
            var cmp = compareVersion(window.APP_VERSION, previous);
            if (cmp < 0) {
                console.warn('[升级提示] 当前加载版本 ' + window.APP_VERSION + ' 低于已提示版本 ' + previous + '，按旧缓存处理，不弹窗');
                Store.del(K.upgrade);
                return null;
            }
            shouldShow = cmp > 0;
        } else if (legacy && legacy.phase === 'pending' && legacy.to === window.APP_VERSION) {
            shouldShow = true; // 兼容旧状态机：目标版本已实际加载，补一次提示
        }

        var saved = previous === window.APP_VERSION || Store.set(K.versionNotice, window.APP_VERSION);
        Store.del(K.upgrade);
        if (!saved) {
            console.warn('[升级提示] 无法保存已展示版本，已跳过提示以避免重复弹窗');
            return null;
        }
        return shouldShow ? (window.APP_NOTES || '') : null;
    }

    /* 升级好了：只提示成功与本次更新内容 */
    function showUpgradeDone(notes) {
        V.openModal('<h3>升级好了</h3>' +
            '<p class="sub">已更新到最新版本，本地数据与设置均保留。</p>' +
            '<p class="sub"><b>本次更新内容</b></p>' +
            '<p class="sub">' + U.esc(notes || '无') + '</p>' +
            '<div class="modal-actions"><button class="btn primary" data-act="closeModal">知道了</button></div>');
    }

    function fetchLatestVersion() {
        return fetch('version.json', { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (v) {
            if (!v || typeof v.version !== 'string' || !v.version.trim()) {
                throw new Error('version.json 缺少有效版本号');
            }
            return v;
        });
    }

    function readRequestedAssetVersion() {
        var requested = '';
        try {
            var u = new URL(location.href);
            requested = u.searchParams.get('_v') || '';
            if (requested) {
                u.searchParams.delete('_v');
                history.replaceState(history.state, '', u.toString());
            }
        } catch (e) {
            console.warn('[升级检测] 无法读取或清理资源版本参数', e);
        }
        return requested;
    }

    // 添加版本区分，强制重新获取静态资源；不依赖 localStorage 才能执行刷新。
    function triggerUpgrade(v) {
        console.log('[升级检测] 服务器版本=' + v.version + '，当前加载版本=' + window.APP_VERSION + '，刷新加载最新资源');
        try {
            var u = new URL(location.href);
            u.searchParams.set('_v', v.version);
            location.replace(u.toString());
        } catch (e) {
            console.warn('[升级检测] 强制刷新失败，尝试普通刷新', e);
            try { location.reload(); } catch (e2) {
                console.warn('[升级检测] 页面刷新失败', e2);
            }
        }
    }

    /* 检查始终比较实际加载的代码版本（固定开启，无开关）；_v 防止缓存未更新时同一次启动无限刷新。 */
    function checkVersion(requestedAssetVersion) {
        fetchLatestVersion().then(function (v) {
            if (v.version === window.APP_VERSION) return;
            if (requestedAssetVersion === v.version) {
                console.warn('[升级检测] 已按版本号刷新过资源，但当前加载版本仍未更新；本次不再循环刷新');
                return;
            }
            triggerUpgrade(v);
        }).catch(function (e) {
            console.warn('[升级检测] 无法检查更新', e);
        });
    }

    /* ---------- iOS 引导 ---------- */
    function iosGuide() {
        try {
            var isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
            var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
            var hasData = state.index.length > 0;
            if (isIOS && !isStandalone && hasData && !Store.get(K.iosGuided, false)) {
                Store.set(K.iosGuided, true);
                V.openModal('<h3>建议添加到主屏幕</h3><p class="sub">在 Safari 中点击"分享 → 添加到主屏幕"，可避免本地数据被系统清理。</p>' +
                    '<div class="modal-actions"><button class="btn primary" data-act="closeModal">知道了</button></div>');
            }
        } catch (e) { }
    }

    /* ---------- 启动 ---------- */
    var booted = false;
    function boot() {
        if (booted) return; // 幂等：避免自动启动与手动触发重复初始化/重复绑定事件
        booted = true;
        loadSettings(); applyTheme(); loadIndex();
        var requestedAssetVersion = readRequestedAssetVersion();
        var upgradeNotes = settleVersionNotice();
        var didUpgrade = upgradeNotes !== null;
        var tm = themeMedia();
        if (tm) { if (tm.addEventListener) tm.addEventListener('change', onSystemThemeChange); else if (tm.addListener) tm.addListener(onSystemThemeChange); }
        /* 升级提示优先：升级期间不自动弹 iOS 引导，避免被其抢走或被覆盖 */
        S.persistStorage(); checkVersion(requestedAssetVersion); if (!didUpgrade) iosGuide();
        // current 指针失效但索引仍有账本时，回落到最近使用的账本，避免用户被困在无账本态
        if (!(state.currentId && findIndexItem(state.currentId)) && state.index.length) {
            state.currentId = state.index[0].id;
            Store.set(K.cur, state.currentId);
        }
        if (state.currentId && findIndexItem(state.currentId)) {
            var txt = Store.getText(K.ledger(state.currentId));
            if (txt != null) {
                var parsed = L.parse(txt);
                if (parsed.errors.length) showValidationErrors(parsed);
                else { ZH.category.normalize(parsed.header); state.ledger = parsed; state.chat = Store.get(K.chat(state.currentId), []); state.pending = Store.get(K.pending(state.currentId), []); }
            }
        }
        render();
        if (state.ledger && state.pending.length) {
            if (didUpgrade) pendingAfterUpgrade = true; // 升级提示优先，待其关闭后再询问
            else setTimeout(ZH.chat.askPending, 400);
        }
        /* 同步立即显示升级提示：确保在任何兜底刷新发生前已渲染，避免提示被无标记的刷新吞掉 */
        if (didUpgrade) showUpgradeDone(upgradeNotes);

        document.addEventListener('click', handleClick);
        document.addEventListener('input', function (e) {
            if (e.target.id === 'searchInput') {
                state.detailQuery = e.target.value;
                U.$('#main').innerHTML = V.viewDetail();
                var s = U.$('#searchInput'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
            }
        });
        document.addEventListener('change', function (e) {
            if (e.target.id === 'monthInput') { state.detailMonth = e.target.value; render(); }
            // 编辑记录时切换类型：同步重建分类下拉
            else if (e.target.id === 'r_type') { V.fillCategoryOptions(U.$('#r_cat'), e.target.value); }
            // 合并分类时切换来源：同步重建目标下拉为同一收支表内的分类
            else if (e.target.id === 'mg_from') { V.fillMergeTargets(e.target.value); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            if (e.target.id === 'chatInput') {
                e.preventDefault();
                if (state.chatBusy) return; // 进行中时 Enter 不发送
                ZH.chat.handleSend();
            }
        });
    }

    ZH.app = {
        render: render, openLedger: openLedger, saveLedger: saveLedger, saveChat: saveChat, savePending: savePending,
        saveIndex: saveIndex, createLedger: createLedger, deleteLedger: deleteLedger,
        storageUsage: storageUsage, renderWarnBar: renderWarnBar, guardWrite: guardWrite, overQuota: overQuota
    };
    function render() { V.render(); renderWarnBar(); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})(window.ZH = window.ZH || {});
