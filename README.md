# 记账 App

不为"管钱"，只为"知道钱花哪了"。对话式记账，纯前端、零构建、数据纯本地。

设计文档见 [`docu/main_design.md`](docu/main_design.md)，实现方案见 [`plans/implementation_plan.md`](plans/implementation_plan.md)。

## 特性

- 自然语言记账：说一句话，AI 解析为结构化记录并回显确认。
- 对话式纠错：以「更正」「删除」开头调整；信息不足只回拒绝原因。
- 流式对话：请求流式响应（`stream: true`），发送/停止一体按钮、状态气泡（思考中 → 回复中）、首 token 30 秒超时、失败气泡可就地编辑重发。
- 多账本：每个账本 = 一份 Markdown 文档，含自描述的账本头（分类表、储蓄目标、分类规则）。
- 分类规则两层：模板默认规则 + 用户强制指令，用户优先。
- 统计：日/月/年收支对比、分类占比饼图、收支趋势折线（纯 SVG，无图表库）。
- 导出/拆分/导入：完整导出、按时间范围部分导出（移出并仅下载）、导入（同名拒绝）。
- 本地优先：`localStorage` 存储 + `navigator.storage.persist()`；iOS 非 standalone 引导添加到主屏幕。
- 主题模式：跟随系统 / 日间 / 夜间，设置页切换，本地持久化，暗色适配统计图表。
- 启动时自动更新：启动对比 `version.json`，检测到新版本即自动刷新加载最新资源，完成后仅提示「升级好了 + 本次更新内容」；更新仅刷新静态资源，**不清除任何本地数据与核心配置**，同一版本只处理一次不反复弹。设置页「更新」开关关闭即纯本地运行；打开时若存在更新会提醒先备份、刷新即更新。

## 文件结构

```
index.html          页面骨架，按序引入脚本与样式
css/style.css       全部样式（含 iOS 安全区适配）
js/version.js       版本常量 APP_VERSION
js/util.js          工具：选择器、转义、格式化、日期、toast
js/store.js         localStorage 封装与键命名、持久化请求
js/templates.js     预设模板（生活 / 项目研发）
js/ledger.js        md 解析 / 序列化 / 校验
js/category.js      分类增删合并
js/charts.js        SVG 饼图与折线
js/ai.js            system prompt、Chat Completions 请求、响应校验
js/chat.js          对话流与 pending 缓冲
js/io.js            导出 / 拆分 / 导入
js/views.js         视图与弹层渲染
js/app.js           状态、事件分发、版本检查、启动
version.json        服务器版本文件
icon.svg            图标
```

## 运行

任意静态服务器即可，无需构建：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 部署

- nginx 等静态托管，Basic Auth 由部署层负责（不属于本应用）。
- 静态文件不得配超长强缓存（除非文件名带内容 hash），否则版本重校验失效；增量更新交由 HTTP 缓存协商。

## 使用

1. 首次进入无账本态，点击「新建账本」选模板，或「导入账本」。
2. 设置页填入 API Base URL / API Key / 模型名（默认适配 DeepSeek）。
3. 记账页输入如「昨天打车 28」，AI 回显后确认；需要改就以「更正：」「删除：」开头。

## 测试

jsdom 冒烟（桩掉 fetch，无需真实 API），保留在仓库中供持续复用：

```bash
npm i jsdom                    # 仅测试需要
node tests/feature.smoke.js    # 主题三态 + 流式对话（SSE 解析 / 状态气泡 / 记账写入）
node tests/upgrade.smoke.js    # 版本检查 / 首页升级弹窗 / 忽略版本 / 升级保留数据与配置
```

## 待办（二期）

- AI 整理：仅调整分类、不改备注，逐条前后对照、逐条裁决、部分执行、未完成退出二次确认。
