/* 预设账本模板（仅作初始分类表，之后可自由修改） */
(function (ZH) {
    'use strict';
    var TEMPLATES = {
        '生活': {
            expense: ['餐饮', '交通', '购物', '居家', '娱乐', '医疗', '教育', '通讯', '人情', '其他'],
            income: ['工资', '理财', '其他收入'],
            defaultRules: [
                { rule: '吃进肚子的（含买菜、食材、外卖、奶茶）', category: '餐饮' },
                { rule: '购买实物商品（非食物）', category: '购物' },
                { rule: '居住相关（房租、水电、物业）', category: '居家' }
            ]
        },
        '项目/研发': {
            expense: ['物料', '生产', '研发', '外包', '差旅', '其他'],
            income: ['项目款', '报销', '其他收入'],
            defaultRules: [
                { rule: '生产制造相关物料、耗材', category: '物料' },
                { rule: '研发工具、设备、软件', category: '研发' },
                { rule: '项目出差相关', category: '差旅' }
            ]
        }
    };
    ZH.templates = { TEMPLATES: TEMPLATES };
})(window.ZH = window.ZH || {});
