/* 导出 / 部分拆分 / 导入 */
(function (ZH) {
    'use strict';
    var U = ZH.util, S = ZH.store, L = ZH.ledger;

    /* 传统下载（回退方案） */
    function download(filename, text) {
        var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    /* 优先让用户指定保存文件（File System Access API），不支持则回退下载。
       返回 Promise<boolean>：true=已保存；false=用户取消保存 */
    function saveFile(filename, text) {
        if (window.showSaveFilePicker) {
            return window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
            }).then(function (handle) {
                return handle.createWritable().then(function (w) {
                    return w.write(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
                        .then(function () { return w.close(); })
                        .then(function () { return true; });
                });
            }).catch(function (err) {
                if (err && err.name === 'AbortError') return false; /* 用户取消，不改动数据 */
                download(filename, text); return true; /* 其他错误回退下载 */
            });
        }
        download(filename, text);
        return Promise.resolve(true);
    }
    function markExported() { var st = ZH.state; if (st.currentId) S.Store.set(S.K.lastExport(st.currentId), Date.now()); }

    function exportFull() {
        var st = ZH.state; if (!st.ledger) return Promise.resolve();
        var filename = (st.ledger.header.name || '账本') + '.md';
        var text = L.serialize(st.ledger.header, st.ledger.records);
        return saveFile(filename, text).then(function (ok) {
            if (!ok) return; /* 用户取消 */
            markExported(); U.toast('已导出'); ZH.app.render();
        });
    }

    function splitExport(from, to, name) {
        var st = ZH.state; if (!st.ledger) return Promise.resolve();
        var keep = [], move = [];
        st.ledger.records.forEach(function (r) { (r.date >= from && r.date <= to) ? move.push(r) : keep.push(r); });
        if (!move.length) { U.toast('该时间范围内没有记录'); return Promise.resolve(); }
        name = (name || '').trim() || (from + '~' + to);
        var newHeader = JSON.parse(JSON.stringify(st.ledger.header));
        newHeader.name = name;
        var text = L.serialize(newHeader, move);
        /* 保存成功后才从原账本移出，避免用户取消却已丢数据 */
        return saveFile(name + '.md', text).then(function (ok) {
            if (!ok) return;
            st.ledger.records = keep;
            ZH.app.saveLedger(); markExported();
            ZH.views.closeModal(); ZH.app.render();
            U.toast('已拆分导出 ' + move.length + ' 条（未加入账本列表）');
        });
    }

    function importLedger(file) {
        var reader = new FileReader();
        reader.onload = function () {
            var st = ZH.state;
            var text = String(reader.result || '');
            var parsed = L.parse(text);
            if (!parsed.header.name) { U.toast('无法识别账本头'); return; }
            if (st.index.some(function (x) { return x.name === parsed.header.name; })) { U.toast('已存在同名账本，拒绝导入'); return; }
            if (parsed.errors.length) { U.toast('账本存在 ' + parsed.errors.length + ' 处分类错误，请先修正'); return; }
            var id = U.uuid();
            S.Store.setText(S.K.ledger(id), L.serialize(parsed.header, parsed.records));
            st.index.push({ id: id, name: parsed.header.name, template: parsed.header.template || '', updatedAt: Date.now() });
            ZH.app.saveIndex();
            U.toast('导入成功');
            ZH.app.openLedger(id);
        };
        reader.readAsText(file);
    }

    function pickFile() {
        var inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.md,text/markdown,text/plain';
        inp.onchange = function () { if (inp.files && inp.files[0]) importLedger(inp.files[0]); };
        inp.click();
    }

    ZH.io = { download: download, markExported: markExported, exportFull: exportFull, splitExport: splitExport, importLedger: importLedger, pickFile: pickFile };
})(window.ZH = window.ZH || {});
