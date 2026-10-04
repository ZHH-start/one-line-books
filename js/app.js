/* 主控：全局 state、账本管理、事件分发、版本检查、启动 */
(function (ZH) {
    'use strict';
    var U = ZH.util, S = ZH.store, L = ZH.ledger, V = ZH.views, IO = ZH.io;
    var K = S.K, Store = S.Store;

    var state = {
        index: [], currentId: null, ledger: null,
        settings: {}, chat: [], pending: [],
        view: 'overview', statMode: 'month',
        detailQuery: '', detailMonth: '',
        chatBusy: null, chatAbort: null
    };
    ZH.state = state;

    function loadSettings() {
        state.settings = Store.get(K.settings, { apiBaseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', checkUpdate: true, theme: 'system' });
        if (!state.settings.theme) state.settings.theme = 'system';
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
        if (!state.ledger || !state.currentId) return;
        Store.setText(K.ledger(state.currentId), L.serialize(state.ledger.header, state.ledger.records));
        var it = findIndexItem(state.currentId);
        if (it) { it.updatedAt = Date.now(); saveIndex(); }
    }
    function saveChat() { if (state.currentId) Store.set(K.chat(state.currentId), state.chat); }
    function savePending() { if (state.currentId) Store.set(K.pending(state.currentId), state.pending); }

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
        ZH.category.merge(state.ledger, from, to);
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
        r.date = U.$('#r_date').value; r.type = U.$('#r_type').value;
        r.category = U.$('#r_cat').value; r.note = U.$('#r_note').value;
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
    /* 启动时自动更新开关：
       - 关闭 → 纯本地运行（不检查、不更新）。
       - 打开 → 先检查一次；若确有可升级版本，提醒先备份账单，刷新页面即更新。 */
    function toggleUpdate() {
        if (state.settings.checkUpdate) {
            state.settings.checkUpdate = false; saveSettings(); render();
            U.toast('已关闭自动更新，App 将纯本地运行');
            return;
        }
        state.settings.checkUpdate = true; saveSettings(); if (state.view === 'settings') render();
        fetch('version.json', { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw 0; return r.json();
        }).then(function (v) {
            var s = Store.get(K.upgrade, null) || {};
            var cur = s.version || window.APP_VERSION;
            if (v && v.version && v.version !== cur) {
                V.openModal('<h3>有新版本可用</h3><p class="sub">建议先备份账单（设置 → 完整导出），刷新页面将会直接更新到最新版本。</p>' +
                    '<div class="modal-actions"><button class="btn primary" data-act="closeModal">知道了</button></div>');
            } else { U.toast('已开启自动更新，将在启动时自动更新'); }
            if (state.view === 'settings') render();
        }).catch(function () { U.toast('已开启自动更新，将在启动时自动更新'); if (state.view === 'settings') render(); });
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
        importLedgerBtn: function () { IO.pickFile(); },
        editGoal: function () { V.modalEditGoal(); },
        saveGoal: saveGoal,
        editCategories: function () { V.modalEditCategories(); },
        saveCategories: saveCategories,
        mergeCategory: function () { V.modalMergeCategory(); },
        doMergeCategory: doMergeCategory,
        editUserRules: function () { V.modalEditUserRules(); },
        saveUserRules: saveUserRules,
        exportFull: function () { IO.exportFull(); },
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
        toggleUpdate: toggleUpdate,
        send: function () { ZH.chat.handleSend(); },
        chatSend: function () { if (state.chatBusy) ZH.chat.stopRequest(); else ZH.chat.handleSend(); },
        userMsg: function (el) { ZH.chat.askDeleteUserMsg(el); },
        doDeleteUserMsg: function (el) { ZH.chat.doDeleteUserMsg(el); },
        setTheme: setTheme,
        statMode: function (el) { state.statMode = el.getAttribute('data-mode'); render(); },
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

    /* ---------- 版本检查与自动升级（重构：不依赖 HTTP 缓存时序） ---------- */
    function settleUpgrade() {
        var s = Store.get(K.upgrade, null); // 检查升级标志位
        if (s && s.phase === 'pending') { // pending状态，说明已经升级完成
            var d = { phase: 'done', version: s.to || window.APP_VERSION, notes: s.notes || '', at: Date.now() }; // 已经升级，标志位调整为done
            Store.set(K.upgrade, d); // 升级标志位置位
            console.log('[升级完成] 本地加载到 ' + window.APP_VERSION + '，期望 ' + (s.to || '?'));
            return d;
        }
        if (!s) { // 升级后首次加载
            Store.set(K.upgrade, { phase: 'done', version: window.APP_VERSION, notes: '', at: Date.now() });
        }
        return null;
    }

    /* 升级好了：只提示成功与本次更新内容 */
    function showUpgradeDone(notes) {
        V.openModal('<h3>升级好了</h3>' +
            '<p class="sub">已更新到最新版本，本地数据与设置均保留。</p>' +
            '<p class="sub"><b>本次更新内容</b></p>' +
            '<p class="sub">' + U.esc(notes || '无') + '</p>' +
            '<div class="modal-actions"><button class="btn primary" data-act="closeModal">知道了</button></div>');
    }

    // 自动更新
    function triggerUpgrade(v, cur) {
        var ok = Store.set(K.upgrade, { phase: 'pending', to: v.version, notes: v.notes || '', from: cur, at: Date.now() });
        if (!ok) { console.warn('[升级检测] 升级记录写入失败（存储可能已满），本次不刷新'); return false; }
        console.log('[升级检测] 有新版本 ' + cur + ' → ' + v.version + '，刷新加载最新资源');
        try { // 添加版本区分，强制重新获取
            var u = new URL(location.href);
            u.searchParams.set('_v', encodeURIComponent(v.version));
            location.replace(u.toString());
        } catch (e) {
            try { location.reload(); } catch (e2) { /* 环境无法刷新（如测试），由下次启动检测兜底 */ }
        }
        return true;
    }

    /* 启动时检查更新：拉远程 version.json，与本地“已完成版本”对比；不同才触发。 */
    function checkVersion() {
        if (!state.settings.checkUpdate) return;
        fetch('version.json', { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw 0; return r.json();
        }).then(function (v) {
            if (!v || !v.version) return;
            var s = Store.get(K.upgrade, null) || {};
            var cur = s.version || window.APP_VERSION;
            console.log('[升级检测] 服务器=' + v.version + ' 本地已加载=' + cur);
            if (v.version === cur) return; // 一致：已是最新
            triggerUpgrade(v, cur);
        }).catch(function () { });
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
        /* 升级结算（本地、同步、零网络）：若上次留有 pending 记录，说明升级已生效，
           本次即为“刚升级完成”→ 标记 done 并准备弹窗。*/
        var didUpgrade = false, upgradeNotes = '';
        var settled = settleUpgrade();
        if (settled) { didUpgrade = true; upgradeNotes = settled.notes || ''; }
        var tm = themeMedia();
        if (tm) { if (tm.addEventListener) tm.addEventListener('change', onSystemThemeChange); else if (tm.addListener) tm.addListener(onSystemThemeChange); }
        /* 升级提示优先：升级期间不自动弹 iOS 引导，避免被其抢走或被覆盖 */
        S.persistStorage(); checkVersion(); if (!didUpgrade) iosGuide();
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
        saveIndex: saveIndex, createLedger: createLedger, deleteLedger: deleteLedger
    };
    function render() { V.render(); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})(window.ZH = window.ZH || {});
