/* 记账对话流：气泡渲染、纠错、模糊拒绝、按账本隔离的 pending 缓冲 */
(function (ZH) {
    'use strict';
    var U = ZH.util;

    function chatListView() {
        return '<div class="chat"><div class="chat-list" id="chatList"></div>' +
            '<div class="chat-input"><input id="chatInput" placeholder="说吧，例如：午饭 35" autocomplete="off"><button class="btn primary" data-act="send">发送</button></div></div>';
    }

    function renderChatList() {
        var st = ZH.state, list = U.$('#chatList'); if (!list) return;
        if (!st.chat.length) {
            list.innerHTML = '<div class="empty">试试输入：<br>「昨天打车 28」<br>「更正：是 260」</div>';
            return;
        }
        var h = '';
        st.chat.forEach(function (m) {
            if (m.role === 'user') {
                h += '<div class="bubble user">' + U.esc(m.text) + '</div>';
            } else {
                h += '<div class="bubble ai">' + U.esc(m.text);
                if (m.records && m.records.length) {
                    h += '<div>' + m.records.map(function (r) {
                        return '<span class="chip" data-act="editChip" data-rec="' + encodeURIComponent(JSON.stringify(r)) + '">✎ ' + U.esc(r.category) + ' ' + U.fmt(r.amount) + '</span>';
                    }).join('') + '</div>';
                }
                h += '</div>';
            }
        });
        list.innerHTML = h;
    }

    function mountChat() { renderChatList(); scrollChat(); }
    function scrollChat() { var l = U.$('#chatList'); if (l) l.scrollTop = l.scrollHeight; }

    function echoText(action, records) {
        var s = records.map(function (r) { return r.category + ' ' + U.fmt(r.amount) + '（' + (r.note || '') + '）'; }).join('｜');
        return (action === 'update' ? '更正：已记 ' : '已记 ') + records.length + ' 笔：' + s;
    }
    function pushAI(text, records) {
        var st = ZH.state;
        var msg = { role: 'assistant', text: text };
        if (records) msg.records = records;
        st.chat.push(msg);
        ZH.app.saveChat(); renderChatList(); scrollChat();
    }

    function handleSend() {
        var st = ZH.state;
        var input = U.$('#chatInput'); if (!input) return;
        var text = (input.value || '').trim();
        if (!text) return;
        input.value = '';
        st.chat.push({ role: 'user', text: text, ts: Date.now() });
        ZH.app.saveChat(); renderChatList(); scrollChat();

        ZH.ai.callAI(text).then(function (json) {
            var v = ZH.ai.validateAction(json);
            if (!v.ok) { pushAI(v.reason); return; }
            if (v.action === 'reject') { pushAI(v.reason); return; }
            if (v.action === 'add') {
                v.records.forEach(function (r) { st.ledger.records.push(ZH.ai.normalize(r)); });
                ZH.app.saveLedger();
                pushAI(echoText('add', v.records), v.records.map(ZH.ai.normalize));
            } else if (v.action === 'update') {
                var idx = ZH.ai.locateRecord(v.target);
                if (idx < 0) { pushAI('未找到要更正的记录'); return; }
                var nr = ZH.ai.normalize(v.records[0]);
                st.ledger.records[idx] = nr; ZH.app.saveLedger();
                pushAI(echoText('update', [nr]), [nr]);
            } else if (v.action === 'delete') {
                var di = ZH.ai.locateRecord(v.target);
                if (di < 0) { pushAI('未找到要删除的记录'); return; }
                var del = st.ledger.records.splice(di, 1)[0]; ZH.app.saveLedger();
                pushAI('已删除：' + del.category + ' ' + U.fmt(del.amount) + '（' + (del.note || '') + '）');
            }
        }).catch(function (err) {
            if (err && err.code === 'NO_API') {
                pushAI('尚未配置 API，请前往设置页配置后再记账。');
                return;
            }
            // 发送失败：按账本隔离的 pending 缓冲，记录所属账本 id 作二次校验
            st.pending.push({ ledgerId: st.currentId, text: text, ts: Date.now(), time: U.nowPrefix() });
            ZH.app.savePending();
            pushAI('发送失败，内容已保留，稍后可重试。（' + (err && err.message ? err.message : '网络错误') + '）');
        });
    }

    function currentPending() {
        var st = ZH.state;
        return st.pending.filter(function (p) { return p.ledgerId === st.currentId; });
    }
    function askPending() {
        if (!ZH.state.ledger) return;
        var list = currentPending();
        if (!list.length) return;
        var html = '<h3>有待处理的输入</h3><p class="sub">上次发送失败的内容，是否重新发送？</p>';
        list.forEach(function (p) { html += '<div class="card" style="margin:8px 0"><div class="sub">' + U.esc(p.time || '') + '</div><div>' + U.esc(p.text) + '</div></div>'; });
        html += '<div class="modal-actions"><button class="btn" data-act="pendingDiscard">丢弃</button><button class="btn primary" data-act="pendingResend">重新发送</button></div>';
        ZH.views.openModal(html);
    }
    function resendPending() {
        var st = ZH.state;
        var list = currentPending();
        st.pending = st.pending.filter(function (p) { return p.ledgerId !== st.currentId; });
        ZH.app.savePending(); ZH.views.closeModal();
        var txts = list.map(function (p) { return p.text; }).join('\n');
        if (st.view !== 'record') { st.view = 'record'; ZH.app.render(); }
        var input = U.$('#chatInput');
        if (input) { input.value = txts; handleSend(); }
    }
    function discardPending() {
        var st = ZH.state;
        st.pending = st.pending.filter(function (p) { return p.ledgerId !== st.currentId; });
        ZH.app.savePending(); ZH.views.closeModal();
    }

    ZH.chat = { chatListView: chatListView, renderChatList: renderChatList, mountChat: mountChat, handleSend: handleSend, askPending: askPending, resendPending: resendPending, discardPending: discardPending, scrollChat: scrollChat };
})(window.ZH = window.ZH || {});
