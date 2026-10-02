/* 纯 SVG 图表：饼图 + 折线 */
(function (ZH) {
    'use strict';
    var colorAt = ZH.util.colorAt, esc = ZH.util.esc;

    function pieChart(segs, total) {
        var cx = 100, cy = 100, r = 80, a = -Math.PI / 2, paths = '';
        segs.forEach(function (s, i) {
            var ang = s.value / total * Math.PI * 2;
            var a2 = a + ang;
            var x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
            var x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
            var large = ang > Math.PI ? 1 : 0;
            if (segs.length === 1) {
                paths = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + colorAt(i) + '"/>';
            } else {
                paths += '<path d="M' + cx + ' ' + cy + ' L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + colorAt(i) + '"/>';
            }
            a = a2;
        });
        return '<svg class="chart" width="200" height="200" viewBox="0 0 200 200">' + paths + '</svg>';
    }

    function pieBlock(segs) {
        segs = segs.filter(function (s) { return s.value > 0; });
        if (!segs.length) return '<div class="empty">暂无数据</div>';
        segs.sort(function (a, b) { return b.value - a.value; });
        var total = segs.reduce(function (s, x) { return s + x.value; }, 0);
        var svg = pieChart(segs, total);
        var leg = '<div class="legend">' + segs.map(function (s, i) {
            return '<span><i class="dot" style="background:' + colorAt(i) + '"></i>' + esc(s.label) + ' ' + Math.round(s.value / total * 100) + '%</span>';
        }).join('') + '</div>';
        return svg + leg;
    }

    /* 折线图视觉尺寸上限：避免桌面端全屏时被无限放大 */
    function availWidth() {
        var el = document.querySelector('main');
        var w = (el && el.clientWidth) ? el.clientWidth : window.innerWidth;
        w -= 52; /* 卡片左右 margin 12 + padding 14 */
        return Math.max(260, Math.min(620, Math.round(w)));
    }

    function lineChart(data) {
        var w = availWidth(), hgt = 180, pl = 36, pr = 10, pt = 10, pb = 24;
        var iw = w - pl - pr, ih = hgt - pt - pb;
        var max = 0; data.forEach(function (d) { max = Math.max(max, d.inc, d.exp); });
        if (max <= 0) max = 1;
        var n = data.length;
        function X(i) { return n <= 1 ? pl + iw / 2 : pl + iw * i / (n - 1); }
        function Y(v) { return pt + ih - (v / max) * ih; }
        var grid = '';
        for (var g = 0; g <= 4; g++) {
            var y = pt + ih * g / 4;
            grid += '<line x1="' + pl + '" y1="' + y + '" x2="' + (pl + iw) + '" y2="' + y + '" style="stroke:var(--chart-grid)"/>';
            grid += '<text x="' + (pl - 4) + '" y="' + (y + 3) + '" font-size="10" text-anchor="end" style="fill:var(--chart-label)">' + Math.round(max * (4 - g) / 4) + '</text>';
        }
        function poly(key, color) {
            return '<polyline fill="none" stroke-width="2" style="stroke:' + color + '" points="' + data.map(function (d, i) { return X(i).toFixed(1) + ',' + Y(d[key]).toFixed(1); }).join(' ') + '"/>' +
                data.map(function (d, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(d[key]).toFixed(1) + '" r="2.5" style="fill:' + color + '"/>'; }).join('');
        }
        var labels = data.map(function (d, i) {
            if (n > 8 && i % 2 !== 0) return '';
            var lb = d.label.length > 7 ? d.label.slice(5) : d.label;
            return '<text x="' + X(i).toFixed(1) + '" y="' + (hgt - 6) + '" font-size="10" text-anchor="middle" style="fill:var(--chart-label)">' + esc(lb) + '</text>';
        }).join('');
        return '<svg class="chart line" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '" preserveAspectRatio="xMidYMid meet">' + grid + poly('inc', 'var(--income)') + poly('exp', 'var(--expense)') + labels + '</svg>';
    }

    ZH.charts = { pieBlock: pieBlock, lineChart: lineChart };
})(window.ZH = window.ZH || {});
