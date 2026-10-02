/* 记账对话流：气泡渲染、纠错、模糊拒绝、流式状态气泡、失败就地编辑重发、按账本隔离的 pending 缓冲 */
(function (ZH) {
    'use strict';
    var U = ZH.util;
    var FIRST_TOKEN_MS = 30000; // 首 token 超时（思考中阶段）

    function chatListView() {
        return '<div class="chat"><div class="chat-list" id="chatList"></div>' +
            '<div class="chat-input"><input id="chatInput" placeholder="说吧，例如：午饭 35" autocomplete="off">' +
            '<button class="btn primary" id="chatBtn" data-act="chatSend">发送</button></div></div>';
    }

    /* 进行中的状态气泡：思考中 / 回复中 */
    function statusBubbleHtml() {
        var b = ZH.state.chatBusy;
        if (!b) return '';
        var label = b.phase === 'thinking' ? '思考中' : '回复中';
        return '<div class="bubble ai status" id="chatStatus"><span>' + label + '</span><span class="dots"><i></i><i></i><i></i></span></div>';
    }

    function lastUserIndex() {
        var arr = ZH.state.chat;
        for (var i = arr.length - 1; i >= 0; i--) if (arr[i].role === 'user') return i;
        return -1;
    }

    function renderChatList() {
        var st = ZH.state, list = U.$('#chatList'); if (!list) return;
        if (!st.chat.length && !st.chatBusy) {
            list.innerHTML = '<div class="empty">试试输入：<br>「昨天打车 28」<br>「更正：是 260」</div>';
            return;
        }
        var lastU = lastUserIndex(), h = '';
        st.chat.forEach(function (m, i) {
            if (m.role === 'user') {
                if (m.editing) {
                    h += '<div class="bubble user editing">' +
                        '<textarea class="edit-area" id="editUserArea">' + U.esc(m.text) + '</textarea>' +
                        '<div class="edit-actions">' +
                        '<button class="btn" data-act="cancelEditUser" data-idx="' + i + '">取消</button>' +
                        '<button class="btn primary" data-act="resendUser" data-idx="' + i + '">重新发送</button>' +
                        '</div></div>';
                } else {
                    var editable = i === lastU;
                    h += '<div class="bubble user' + (m.failed ? ' failed' : '') + '"' +
                        (editable ? ' data-act="editUser" data-idx="' + i + '"' : '') + '>' + U.esc(m.text) + '</div>';
                }
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
        h += statusBubbleHtml();
        list.innerHTML = h;
    }

    function updateChatButton() {
        var btn = U.$('#chatBtn'); if (!btn) return;
        if (ZH.state.chatBusy) { btn.textContent = '停止'; btn.classList.remove('primary'); btn.classList.add('danger'); }
        else { btn.textContent = '发送'; btn.classList.add('primary'); btn.classList.remove('danger'); }
    }

    /* 仅更新状态气泡，避免整列表重建干扰输入 */
    function updateStatusBubble() {
        var st = ZH.state, el = U.$('#chatStatus');
        var b = st.chatBusy;
        if (!b) { if (el && el.parentNode) el.parentNode.removeChild(el); updateChatButton(); return; }
        if (el) {
            el.innerHTML = '<span>' + (b.phase === 'thinking' ? '思考中' : '回复中') + '</span><span class="dots"><i></i><i></i><i></i></span>';
        } else { renderChatList(); }
    }

    function mountChat() { renderChatList(); updateChatButton(); scrollChat(); }
    function scrollChat() { var l = U.$('#chatList'); if (l) l.scrollTop = l.scrollHeight; }
    function saveAndRender() { ZH.app.saveChat(); renderChatList(); updateChatButton(); scrollChat(); }

    function echoText(action, records) {
        var s = records.map(function (r) { return r.category + ' ' + U.fmt(r.amount) + '（' + (r.note || '') + '）'; }).join('｜');
        return (action === 'update' ? '更正：已记 ' : '已记 ') + records.length + ' 笔：' + s;
    }
    function pushAI(text, records) {
        var st = ZH.state;
        var msg = { role: 'assistant', text: text };
        if (records) msg.records = records;
        st.chat.push(msg);
        saveAndRender();
    }

    function handleSend() {
        var st = ZH.state;
        if (st.chatBusy) return; // 请求进行中，忽略
        var input = U.$('#chatInput'); if (!input) return;
        var text = (input.value || '').trim();
        if (!text) return;
        input.value = '';
        st.chat.push({ role: 'user', text: text });
        saveAndRender();
        startRequest(text, st.chat.length - 1);
    }

    /* 发起流式请求：状态气泡 + 首 token 超时 + 失败标记 */
    function startRequest(text, userIdx) {
        var st = ZH.state;
        var ledgerId = st.currentId;
        st.chatBusy = { phase: 'thinking' };
        renderChatList(); updateChatButton(); scrollChat();

        var controller = new AbortController();
        st.chatAbort = controller;
        var timer = setTimeout(function () {
            if (st.chatAbort === controller) { controller.__abortReason = 'timeout'; controller.abort('timeout'); }
        }, FIRST_TOKEN_MS);

        var firstToken = false;
        function onToken() {
            if (firstToken) return;
            firstToken = true;
            clearTimeout(timer);
            if (st.chatBusy && st.chatAbort === controller) { st.chatBusy.phase = 'replying'; updateStatusBubble(); }
        }

        ZH.ai.callAIStream(text, { signal: controller.signal, onToken: onToken }).then(function (json) {
            clearTimeout(timer);
            st.chatBusy = null; st.chatAbort = null;
            if (st.currentId !== ledgerId) return; // 已切换账本，丢弃结果
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
            clearTimeout(timer);
            var reason = controller.__abortReason || (controller.signal ? controller.signal.reason : null);
            var aborted = err && err.name === 'AbortError';
            if (st.chatAbort === controller) { st.chatBusy = null; st.chatAbort = null; }
            if (st.currentId !== ledgerId) return;

            if (err && err.code === 'NO_API') {
                failAI(userIdx, '尚未配置 API，请前往设置页配置后再记账。', false);
                return;
            }
            var why = reason === 'timeout' ? 'AI 无响应' : (aborted ? '已停止' : '发送失败');
            if (reason !== 'switch') {
                st.pending.push({ ledgerId: st.currentId, text: text, time: U.nowPrefix() });
                ZH.app.savePending();
            }
            failAI(userIdx, why + '，点击上方消息可编辑重发。', true);
        });
    }

    /* 失败：标记末条用户消息可编辑重发，并追加 AI 提示 */
    function failAI(userIdx, aiText, markFailed) {
        var st = ZH.state;
        if (markFailed && st.chat[userIdx]) st.chat[userIdx].failed = true;
        st.chatBusy = null;
        st.chat.push({ role: 'assistant', text: aiText });
        saveAndRender();
    }

    /* 手动停止当前请求 */
    function stopRequest() {
        var st = ZH.state;
        if (st.chatAbort) { try { st.chatAbort.__abortReason = 'user'; st.chatAbort.abort('user'); } catch (e) { } }
    }

    /* 点击气泡就地编辑 */
    function editUserMsg(el) {
        var st = ZH.state, i = parseInt(el.getAttribute('data-idx'), 10);
        if (!st.chat[i] || st.chat[i].role !== 'user') return;
        st.chat.forEach(function (m) { if (m.editing) delete m.editing; });
        st.chat[i].editing = true;
        renderChatList(); scrollChat();
        var a = U.$('#editUserArea');
        if (a) { a.focus(); try { a.setSelectionRange(a.value.length, a.value.length); } catch (e) { } }
    }
    function cancelEditUserMsg(el) {
        var st = ZH.state, i = parseInt(el.getAttribute('data-idx'), 10);
        if (st.chat[i]) { delete st.chat[i].editing; delete st.chat[i].failed; }
        renderChatList();
    }
    function resendUserMsg(el) {
        var st = ZH.state, i = parseInt(el.getAttribute('data-idx'), 10);
        var area = U.$('#editUserArea');
        var text = area ? (area.value || '').trim() : '';
        if (!text) { U.toast('内容不能为空'); return; }
        if (!st.chat[i] || st.chat[i].role !== 'user') return;
        st.chat[i] = { role: 'user', text: text };
        st.chat = st.chat.slice(0, i + 1); // 丢弃其后的失败提示等
        ZH.app.saveChat();
        renderChatList(); updateChatButton(); scrollChat();
        startRequest(text, i);
    }

    /* ---------- 发送失败缓冲（每次打开询问是否处理） ---------- */
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

    ZH.chat = {
        chatListView: chatListView, renderChatList: renderChatList, mountChat: mountChat,
        handleSend: handleSend, stopRequest: stopRequest,
        editUserMsg: editUserMsg, cancelEditUserMsg: cancelEditUserMsg, resendUserMsg: resendUserMsg,
        askPending: askPending, resendPending: resendPending, discardPending: discardPending, scrollChat: scrollChat
    };
})(window.ZH = window.ZH || {});
