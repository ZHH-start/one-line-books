/* 主控：全局 state、账本管理、事件分发、版本检查、启动 */
(function (ZH) {
    'use strict';
    var U = ZH.util, S = ZH.store, L = ZH.ledger, V = ZH.views, IO = ZH.io;
    var K = S.K, Store = S.Store;

    var state = {
        index: [], currentId: null, ledger: null,
        settings: {}, chat: [], pending: [],
        view: 'overview', statMode: 'month',
        detailQuery: '', detailMonth: ''
    };
    ZH.state = state;

    function loadSettings() {
        state.settings = Store.get(K.settings, { apiBaseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', timezone: 'auto', checkUpdate: true });
    }
    function saveSettings() { Store.set(K.settings, state.settings); }
    function loadIndex() { state.index = Store.get(K.idx, []); state.currentId = Store.get(K.cur, null); }
    function saveIndex() { Store.set(K.idx, state.index); }
    function findIndexItem(id) { for (var i = 0; i < state.index.length; i++) if (state.index[i].id === id) return state.index[i]; return null; }

    function openLedger(id) {
        var text = Store.getText(K.ledger(id));
        if (text == null) { U.toast('账本不存在'); return; }
        var parsed = L.parse(text);
        if (parsed.errors.length) { showValidationErrors(parsed); return; }
        state.currentId = id; Store.set(K.cur, id);
        state.ledger = parsed;
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
        var html = '<h3>账本数据有误</h3><p class="sub">以下记录引用了账本头未声明的分类，请修正后使用。</p>';
        parsed.errors.forEach(function (e) { html += '<div class="sub" style="margin:8px 0">第 ' + e.line + ' 行：' + U.esc(e.text) + '<br>— ' + U.esc(e.reason) + '</div>'; });
        html += '<div class="modal-actions"><button class="btn" data-act="closeModal">关闭</button></div>';
        V.openModal(html);
    }

    /* ---------- 账本管理 ---------- */
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
    function doDeleteLedger(id) {
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

    /* ---------- 事件分发 ---------- */
    function handleClick(e) {
        var el = e.target.closest('[data-act]'); if (!el) return;
        var act = el.getAttribute('data-act');
        switch (act) {
            case 'closeModal':
                if (el.classList.contains('mask')) { if (e.target === el) V.closeModal(); }
                else V.closeModal();
                break;
            case 'nav': state.view = el.getAttribute('data-view'); render(); break;
            case 'gotoSettings': state.view = 'settings'; render(); break;
            case 'switchLedger': V.modalSwitchLedger(); break;
            case 'pickLedger': openLedger(el.getAttribute('data-id')); V.closeModal(); break;
            case 'newLedger': V.modalNewLedger(); break;
            case 'doNewLedger': { var n = U.$('#nl_name'), t = U.$('#nl_tpl'); createLedger(n ? n.value : '', t ? t.value : '生活'); V.closeModal(); break; }
            case 'deleteLedger': deleteLedger(el.getAttribute('data-id')); break;
            case 'doDeleteLedger': doDeleteLedger(el.getAttribute('data-id')); break;
            case 'importLedgerBtn': IO.pickFile(); break;
            case 'editGoal': V.modalEditGoal(); break;
            case 'saveGoal': {
                var g = U.$('#g_amt'), p = U.$('#g_period');
                var amt = parseFloat(g ? g.value : '');
                if (isNaN(amt) || amt <= 0) state.ledger.header.savingGoal = null;
                else state.ledger.header.savingGoal = { amount: Math.round(amt * 100) / 100, period: p && p.value === 'year' ? 'year' : 'month' };
                saveLedger(); V.closeModal(); render(); break;
            }
            case 'editCategories': V.modalEditCategories(); break;
            case 'saveCategories': {
                var e1 = L.splitCats(U.$('#c_exp').value), i1 = L.splitCats(U.$('#c_inc').value);
                if (e1.indexOf('其他') < 0) e1.push('其他');
                var used = state.ledger.records.map(function (r) { return r.category; });
                var removed = state.ledger.header.expenseCategories.concat(state.ledger.header.incomeCategories).filter(function (c) {
                    return e1.concat(i1).indexOf(c) < 0 && used.indexOf(c) >= 0;
                });
                if (removed.length) { U.toast('分类「' + removed.join('、') + '」仍有记录引用，请先处理'); return; }
                state.ledger.header.expenseCategories = e1; state.ledger.header.incomeCategories = i1;
                saveLedger(); V.closeModal(); render(); break;
            }
            case 'mergeCategory': V.modalMergeCategory(); break;
            case 'doMergeCategory': {
                var from = U.$('#mg_from').value, to = U.$('#mg_to').value;
                if (from === to) { U.toast('来源与目标不能相同'); return; }
                var cnt = ZH.category.countRefs(state.ledger, from);
                ZH.category.merge(state.ledger, from, to);
                saveLedger(); V.closeModal(); render();
                U.toast('已合并「' + from + '」→「' + to + '」，改写 ' + cnt + ' 条'); break;
            }
            case 'editUserRules': V.modalEditUserRules(); break;
            case 'saveUserRules': {
                var txt = U.$('#ur_text').value;
                var rules = [];
                txt.split(/\n/).forEach(function (line) {
                    var m = line.match(/^-\s*(.+?)\s*-\s*(.+?)\s*$/) || line.match(/^(.+?)\s*-\s*(.+?)\s*$/);
                    if (m) rules.push({ rule: m[1].trim(), category: m[2].trim() });
                });
                state.ledger.header.userRules = rules; saveLedger(); V.closeModal(); render(); break;
            }
            case 'exportFull': IO.exportFull(); break;
            case 'openSplit': V.modalSplit(); break;
            case 'doSplit': {
                var f = U.$('#sp_from').value, t2 = U.$('#sp_to').value, nm = U.$('#sp_name').value;
                if (!f || !t2) { U.toast('请选择时间范围'); return; }
                if (f > t2) { U.toast('开始日期不能晚于结束日期'); return; }
                IO.splitExport(f, t2, nm); break;
            }
            case 'editLedger': V.modalSwitchLedger(); break;
            case 'editRecord': V.modalEditRecord(parseInt(el.getAttribute('data-idx'), 10)); break;
            case 'saveRecord': {
                var idx = parseInt(el.getAttribute('data-idx'), 10);
                var r = state.ledger.records[idx]; if (!r) break;
                r.date = U.$('#r_date').value; r.category = U.$('#r_cat').value;
                r.amount = Math.round(parseFloat(U.$('#r_amt').value) * 100) / 100 || 0;
                r.note = U.$('#r_note').value; r.type = U.$('#r_type').value;
                saveLedger(); V.closeModal(); render(); break;
            }
            case 'delRecord': {
                var di = parseInt(el.getAttribute('data-idx'), 10);
                state.ledger.records.splice(di, 1); saveLedger(); V.closeModal(); render(); break;
            }
            case 'editChip': {
                try { var rec = JSON.parse(decodeURIComponent(el.getAttribute('data-rec'))); V.modalRecordFromChat(rec); } catch (err) { }
                break;
            }
            case 'saveChatRecord': {
                var rec2 = { date: U.$('#r_date').value, type: U.$('#r_type').value, category: U.$('#r_cat').value, amount: Math.round(parseFloat(U.$('#r_amt').value) * 100) / 100 || 0, note: U.$('#r_note').value };
                var found = -1;
                for (var i = 0; i < state.ledger.records.length; i++) { if (L.match(state.ledger.records[i], rec2)) { found = i; break; } }
                if (found < 0) { U.toast('原记录已变动，请在明细页编辑'); V.closeModal(); break; }
                state.ledger.records[found] = rec2; saveLedger(); V.closeModal(); render(); break;
            }
            case 'saveAIConfig':
                state.settings.apiBaseUrl = U.$('#set_base').value.trim();
                state.settings.apiKey = U.$('#set_key').value.trim();
                state.settings.model = U.$('#set_model').value.trim();
                saveSettings(); U.toast('已保存'); break;
            case 'saveTZ': state.settings.timezone = U.$('#set_tz').value.trim() || 'auto'; saveSettings(); U.toast('已保存'); break;
            case 'toggleUpdate': state.settings.checkUpdate = !state.settings.checkUpdate; saveSettings(); render(); break;
            case 'send': ZH.chat.handleSend(); break;
            case 'statMode': state.statMode = el.getAttribute('data-mode'); render(); break;
            case 'pendingResend': ZH.chat.resendPending(); break;
            case 'pendingDiscard': ZH.chat.discardPending(); break;
        }
    }

    /* ---------- 版本检查 ---------- */
    function checkVersion() {
        if (!state.settings.checkUpdate) return;
        fetch('version.json', { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw 0; return r.json();
        }).then(function (v) {
            if (v && v.version && v.version !== window.APP_VERSION) {
                var html = '<h3>发现新版本</h3><p class="sub">最新版本 ' + U.esc(v.version) + '，当前 ' + window.APP_VERSION + '。可忽略继续使用旧版本。</p>' +
                    (v.notes ? '<p class="sub">' + U.esc(v.notes) + '</p>' : '') +
                    '<div class="modal-actions"><button class="btn primary" data-act="closeModal">知道了</button></div>';
                V.openModal(html);
            }
        }).catch(function () { });
    }

    /* ---------- iOS 引导 ---------- */
    function iosGuide() {
        try {
            var isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
            var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
            var hasData = state.index.length > 0;
            if (isIOS && !isStandalone && hasData && !Store.get('zh:iosGuided', false)) {
                Store.set('zh:iosGuided', true);
                V.openModal('<h3>建议添加到主屏幕</h3><p class="sub">在 Safari 中点击"分享 → 添加到主屏幕"，可避免本地数据被系统清理。</p>' +
                    '<div class="modal-actions"><button class="btn primary" data-act="closeModal">知道了</button></div>');
            }
        } catch (e) { }
    }

    /* ---------- 启动 ---------- */
    function boot() {
        loadSettings(); loadIndex();
        S.persistStorage(); checkVersion(); iosGuide();
        if (state.currentId && findIndexItem(state.currentId)) {
            var txt = Store.getText(K.ledger(state.currentId));
            if (txt != null) {
                var parsed = L.parse(txt);
                if (parsed.errors.length) showValidationErrors(parsed);
                else { state.ledger = parsed; state.chat = Store.get(K.chat(state.currentId), []); state.pending = Store.get(K.pending(state.currentId), []); }
            }
        }
        render();
        if (state.ledger && state.pending.length) setTimeout(ZH.chat.askPending, 400);

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
            if (e.key === 'Enter' && e.target.id === 'chatInput') { e.preventDefault(); ZH.chat.handleSend(); }
        });
    }

    ZH.app = {
        render: render, openLedger: openLedger, saveLedger: saveLedger, saveChat: saveChat, savePending: savePending,
        saveIndex: saveIndex, findIndexItem: findIndexItem, createLedger: createLedger, deleteLedger: deleteLedger
    };
    function render() { V.render(); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})(window.ZH = window.ZH || {});
