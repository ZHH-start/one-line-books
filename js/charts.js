/* 纯 SVG 图表：饼图 + 折线 */
(function (ZH) {
    'use strict';
    var U = ZH.util, colorAt = U.colorAt, esc = U.esc, fmt = U.fmt;

    /* 饼图：扇区带百分比标签与原生 tooltip；分类金额/笔数由统计页的横栏展示 */
    function pieChart(segs, total, size) {
        size = size || 200;
        var c = size / 2, r = size * 0.4, a = -Math.PI / 2, paths = '';
        segs.forEach(function (s, i) {
            var ang = s.value / total * Math.PI * 2, a2 = a + ang;
            var color = colorAt(i);
            var pct = Math.round(s.value / total * 100);
            var tip = '<title>' + esc(s.label) + ' ' + pct + '% · ' + fmt(s.value) + '</title>';
            var labelStyle = 'font-size="11" font-weight="600" text-anchor="middle" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.25);stroke-width:2px"';
            if (segs.length === 1) {
                paths = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" style="fill:' + color + '">' + tip + '</circle>' +
                    '<text x="' + c + '" y="' + (c + 4) + '" ' + labelStyle + '>100%</text>';
            } else {
                var x1 = c + r * Math.cos(a), y1 = c + r * Math.sin(a);
                var x2 = c + r * Math.cos(a2), y2 = c + r * Math.sin(a2);
                var large = ang > Math.PI ? 1 : 0;
                paths += '<path d="M' + c + ' ' + c + ' L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" style="fill:' + color + '">' + tip + '</path>';
                if (ang >= 0.35) {
                    var mid = a + ang / 2;
                    var tx = c + r * 0.62 * Math.cos(mid), ty = c + r * 0.62 * Math.sin(mid);
                    paths += '<text x="' + tx.toFixed(1) + '" y="' + (ty + 3).toFixed(1) + '" ' + labelStyle + '>' + pct + '%</text>';
                }
            }
            a = a2;
        });
        return '<svg class="chart pie" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + paths + '</svg>';
    }

    /* 折线图视觉尺寸上限：避免桌面端全屏时被无限放大。
       统计页在宽屏下为左右两栏，每栏宽度约为 main 的一半。 */
    function availWidth() {
        var el = document.querySelector('main');
        var w = (el && el.clientWidth) ? el.clientWidth : window.innerWidth;
        w -= 52; /* 卡片左右 margin 12 + padding 14 */
        if (window.innerWidth >= 1100) w = w / 2 - 20;
        return Math.max(260, Math.min(620, Math.round(w)));
    }

    function axisFmt(v, max) {
        if (!v) return '0';
        if (max >= 10000) return (v / 10000).toFixed(max >= 100000 ? 0 : 1) + '万';
        if (max >= 1000) return (v / 1000).toFixed(1) + 'k';
        return Math.round(v);
    }

    /* 折线图：默认画收入/支出两条线；传入 opts.series 可只画一条（统计页按栏目拆分） */
    function lineChart(data, opts) {
        opts = opts || {};
        var series = opts.series || [
            { key: 'inc', color: 'var(--income)', name: '收入' },
            { key: 'exp', color: 'var(--expense)', name: '支出' }
        ];
        var w = opts.width || availWidth(), hgt = opts.height || 180, pl = 40, pr = 12, pt = 12, pb = 24;
        var iw = w - pl - pr, ih = hgt - pt - pb;
        var n = data.length;
        if (!n) return '<div class="empty">暂无数据</div>';
        var max = 0;
        data.forEach(function (d) {
            series.forEach(function (s) { max = Math.max(max, Number(d[s.key]) || 0); });
        });
        if (max <= 0) max = 1;
        function X(i) { return n <= 1 ? pl + iw / 2 : pl + iw * i / (n - 1); }
        function Y(v) { return pt + ih - (v / max) * ih; }
        var grid = '';
        for (var g = 0; g <= 4; g++) {
            var y = pt + ih * g / 4;
            grid += '<line x1="' + pl + '" y1="' + y + '" x2="' + (pl + iw) + '" y2="' + y + '" style="stroke:var(--chart-grid)"/>';
            grid += '<text x="' + (pl - 4) + '" y="' + (y + 3) + '" font-size="10" text-anchor="end" style="fill:var(--chart-label)">' + axisFmt(max * (4 - g) / 4, max) + '</text>';
        }
        function seriesOf(s) {
            var pts = data.map(function (d, i) { return X(i).toFixed(1) + ',' + Y(Number(d[s.key]) || 0).toFixed(1); });
            var base = (pt + ih).toFixed(1);
            var area = n > 1 ? '<polygon points="' + X(0).toFixed(1) + ',' + base + ' ' + pts.join(' ') + ' ' + X(n - 1).toFixed(1) + ',' + base + '" style="fill:' + s.color + ';fill-opacity:.10"/>' : '';
            var line = '<polyline fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:' + s.color + '" points="' + pts.join(' ') + '"/>';
            var dots = data.map(function (d, i) {
                var v = Number(d[s.key]) || 0;
                return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6" style="fill:' + s.color + '"><title>' + esc(d.label + ' ' + s.name + ' ' + fmt(v)) + '</title></circle>';
            }).join('');
            return area + line + dots;
        }
        var step = Math.max(1, Math.ceil(n / 7));
        var labels = data.map(function (d, i) {
            if (n > 8 && i % step !== 0 && i !== n - 1) return '';
            return '<text x="' + X(i).toFixed(1) + '" y="' + (hgt - 6) + '" font-size="10" text-anchor="middle" style="fill:var(--chart-label)">' + esc(d.label) + '</text>';
        }).join('');
        return '<svg class="chart line" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '" preserveAspectRatio="xMidYMid meet">' + grid + series.map(seriesOf).join('') + labels + '</svg>';
    }

    ZH.charts = { pieChart: pieChart, lineChart: lineChart };
})(window.ZH = window.ZH || {});
