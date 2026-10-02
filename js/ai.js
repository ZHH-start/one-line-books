/* AI 对接：system prompt 构造、Chat Completions 请求、响应校验 */
(function (ZH) {
    'use strict';

    function buildSystemPrompt() {
        var he = ZH.state.ledger.header;
        var date = ZH.util.todayStr();
        var lines = [];
        lines.push('你是一个中文记账助手。用户用自然语言描述一笔或多笔收支，你负责解析为结构化数据。');
        lines.push('当前日期：' + date + '。解析"昨天""前天"等相对日期必须以该日期为基准。');
        lines.push('当前账本分类表：');
        lines.push('- 支出分类：' + he.expenseCategories.join('、'));
        lines.push('- 收入分类：' + he.incomeCategories.join('、'));
        lines.push('分类决策顺序：');
        lines.push('1. 先检查用户强制定义（用户分类规则）：' + (he.userRules.length ? he.userRules.map(function (r) { return r.rule + '→' + r.category; }).join('；') : '无'));
        lines.push('2. 无强制定义则先按朴素方式直接分类。');
        lines.push('3. 不好分则按用途分。');
        lines.push('4. 仍不确定则按默认规则：' + (he.defaultRules.length ? he.defaultRules.map(function (r) { return r.rule + '→' + r.category; }).join('；') : '无'));
        lines.push('5. 全都不确定时禁止猜测，必须拒绝并要求用户指定分类。');
        lines.push('硬性规则：');
        lines.push('- 退款不记收入，记为对应支出分类的负金额支出。');
        lines.push('- 资产移动（转账、垫付、借贷）记为普通收支，备注写明性质（垫付/收回/借给某人/某人还钱）；用户内部转账（如支付宝转微信）不记账。');
        lines.push('- 信用卡、花呗、白条：刷卡消费正常记支出；还款不记账并说明"信用卡还款不重复入账"；年费、分期手续费、利息记 支出 | 其他。');
        lines.push('- 分类只能从上面分类表中选择，禁止自创。');
        lines.push('用户输入若以"更正"或"删除"开头，表示调整操作：未指定记录则默认上一条，否则按日期或内容定位。');
        lines.push('严格输出 JSON，不要任何多余文字。schema：');
        lines.push('{"action":"add|update|delete|reject","records":[{"date":"YYYY-MM-DD","type":"支出|收入","category":"","amount":0,"note":""}],"target":{"date":"","type":"","category":"","amount":0,"note":""},"reason":""}');
        lines.push('reject 时只填 reason；add 用 records；update/delete 用 target 定位（update 另给 records[0] 为新值）。');
        return lines.join('\n');
    }

    /* 最近记录，供模型定位"上一条"/指定日期的记录 */
    function recentRecords() {
        return ZH.state.ledger.records.slice(-15).map(function (r) {
            return r.date + ' | ' + r.type + ' | ' + r.category + ' | ' + ZH.util.fmt(r.amount) + ' | ' + (r.note || '');
        }).join('\n');
    }

    /* 从字符串中提取结构化 JSON：整体解析失败则截取花括号片段兜底。 */
    function extractJSON(str) {
        str = String(str == null ? '' : str).trim();
        try { return JSON.parse(str); } catch (e) { }
        var m = str.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch (e) { } }
        return null;
    }

    /* 从 Chat Completions 原始响应中取出结构化 JSON */
    function parseAIResponse(data) {
        var choice = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!choice) return null;
        return extractJSON(choice.content);
    }

    /* 组装用户消息：注入最近记录用于定位，再附本次输入 */
    function userMessage(userText) {
        return '【最近记录，供定位参考】\n' + (recentRecords() || '（无）') + '\n\n【本次输入】\n' + userText;
    }

    function buildRequest(userText, stream) {
        var s = ZH.state.settings;
        var url = s.apiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
        var payload = {
            model: s.model, temperature: 0, response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: userMessage(userText) }
            ]
        };
        if (stream) payload.stream = true;
        return {
            url: url,
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
                body: JSON.stringify(payload)
            }
        };
    }

    /* 逐块读取 SSE 流，拼接 delta.content，每个内容块回调 onToken */
    function readSSE(body, onToken) {
        var reader = body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buf = '', content = '';
        function pump() {
            return reader.read().then(function (res) {
                if (res.done) return content;
                buf += decoder.decode(res.value, { stream: true });
                var lines = buf.split('\n'); buf = lines.pop();
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line || line.indexOf('data:') !== 0) continue;
                    var data = line.slice(5).trim();
                    if (!data || data === '[DONE]') continue;
                    var chunk; try { chunk = JSON.parse(data); } catch (e) { continue; }
                    var choice = chunk && chunk.choices && chunk.choices[0];
                    var delta = choice && (choice.delta || choice.message);
                    var piece = delta && delta.content;
                    if (piece) { content += piece; if (onToken) onToken(); }
                }
                return pump();
            });
        }
        return pump();
    }

    function requireApi() {
        var s = ZH.state.settings;
        if (!s.apiBaseUrl || !s.apiKey || !s.model) return false;
        return true;
    }

    function callAI(userText) {
        if (!requireApi()) return Promise.reject({ code: 'NO_API' });
        var r = buildRequest(userText, false);
        return fetch(r.url, r.init).then(function (resp) {
            if (!resp.ok) return resp.text().then(function (t) { throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 120)); });
            return resp.json();
        }).then(function (data) {
            var json = parseAIResponse(data);
            if (!json) throw new Error('返回内容无法解析为 JSON');
            return json;
        });
    }

    /* 流式请求：优先 SSE 增量读取，环境不支持流时回退为普通解析。
       opts: { signal, onToken } */
    function callAIStream(userText, opts) {
        opts = opts || {};
        if (!requireApi()) return Promise.reject({ code: 'NO_API' });
        var r = buildRequest(userText, true);
        if (opts.signal) r.init.signal = opts.signal;
        return fetch(r.url, r.init).then(function (resp) {
            if (!resp.ok) return resp.text().then(function (t) { throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 120)); });
            if (resp.body && resp.body.getReader) return readSSE(resp.body, opts.onToken).then(extractJSON);
            return resp.json().then(parseAIResponse);
        }).then(function (json) {
            if (!json) throw new Error('返回内容无法解析为 JSON');
            return json;
        });
    }

    function validateAction(json) {
        var st = ZH.state;
        if (!json || typeof json !== 'object') return { ok: false, reason: '返回格式非法' };
        var a = json.action;
        if (['add', 'update', 'delete', 'reject'].indexOf(a) < 0) return { ok: false, reason: '未知操作类型' };
        if (a === 'reject') return { ok: true, action: a, reason: json.reason || '无法记录，请补充说明' };
        if (a === 'add' || a === 'update') {
            var recs = json.records;
            if (!Array.isArray(recs) || !recs.length) return { ok: false, reason: '缺少记录' };
            for (var i = 0; i < recs.length; i++) {
                var r = recs[i];
                if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return { ok: false, reason: '日期格式非法' };
                if (r.type !== '支出' && r.type !== '收入') return { ok: false, reason: '类型非法' };
                if (isNaN(Number(r.amount))) return { ok: false, reason: '金额非法' };
                var list = r.type === '收入' ? st.ledger.header.incomeCategories : st.ledger.header.expenseCategories;
                if (list.indexOf(r.category) < 0) return { ok: false, reason: '分类「' + (r.category || '') + '」不在账本分类表内' };
            }
            if (a === 'update' && !json.target) return { ok: false, reason: '缺少定位信息' };
            return { ok: true, action: a, records: recs, target: json.target };
        }
        if (a === 'delete') {
            if (!json.target) return { ok: false, reason: '缺少定位信息' };
            return { ok: true, action: a, target: json.target };
        }
    }

    function locateRecord(t) {
        var cands = ZH.state.ledger.records.map(function (r, i) { return { r: r, i: i }; });
        if (t.date) cands = cands.filter(function (x) { return x.r.date === t.date; });
        if (t.category) cands = cands.filter(function (x) { return x.r.category === t.category; });
        if (t.type) cands = cands.filter(function (x) { return x.r.type === t.type; });
        if (t.note) cands = cands.filter(function (x) { return (x.r.note || '').indexOf(t.note) >= 0; });
        if (t.amount != null && t.amount !== '' && !isNaN(Number(t.amount))) cands = cands.filter(function (x) { return Math.abs(x.r.amount - Number(t.amount)) < 0.005; });
        if (!cands.length) return -1;
        return cands[cands.length - 1].i;
    }

    function normalize(r) {
        return { date: r.date, type: r.type, category: r.category, amount: Math.round(Number(r.amount) * 100) / 100, note: r.note || '' };
    }

    ZH.ai = { buildSystemPrompt: buildSystemPrompt, callAI: callAI, callAIStream: callAIStream, validateAction: validateAction, locateRecord: locateRecord, normalize: normalize };
})(window.ZH = window.ZH || {});
