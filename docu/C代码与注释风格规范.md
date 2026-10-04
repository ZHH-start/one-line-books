
> 本文档为**强制约定**，与业务设计文档解耦；业务逻辑仍以用户实际指定为准。
> 本文档以C语言为例说明要求，但其他语言（JavaScript，HTML等）同样参考。
## 一、文件组织

1. 每个函数的头文件内定义上面允许使用Doxygen风格的块注释写「文件职责」，但如果要写，不做解释，代码注释只写”干了什么，有什么用“。如下：

```c
/**
 * @brief 驱动遍历刷新sta信息（rssi），
 * get_clients 由平台层实现
 * @return int 返回成功刷新的 STA 数。
 */
```

2. 段落之间允许用分节注释分隔，左右各 20 个 `=`，两侧各一空格，保证整体实现清晰可读：

```c
/* ==================== 生命周期 ==================== */
```

3. `#include` 顺序：标准库 → 第三方→ 来自其他软件包但仍属于本人/本团队开发头文件 → 本项目头文件。结构中间空行。举例：
```c
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <ctype.h>
#include <signal.h>

#include <sys/types.h>
#include <sys/stat.h>
#include <json-c/json.h>
#include <coap3/coap.h>

#include <wlink_net.h>
#include <wlink_sys.h>
#include <fw_upgrade.h>
#include <ap_downstream_scheduler.h>
#include <elog.h>

#include "common.h"
#include "stadbHashTable.h"
#include "wlink_uci.h"
```

---

## 二、格式与书写

| 项        | 约定                                 |
| -------- | ---------------------------------- |
| 缩进       | 4 空格，不使用 Tab                       |
| 函数左花括号   | 不独占一行，只在函数参数括号右侧空一格（K&R）           |
| 注释写法     | 大段注释用/**/，少于三行统一用//                |
| 控制语句左花括号 | 不独占一行，只在函数参数括号右侧空一格（K&R）           |
| 换行长度     | 不得断行，一次写完，除非是为了分别注释函数传入变量而每个变量另起一行 |

---

## 三、注释风格（核心约定）

注释分三层，各司其职，**严禁设计说明堆在函数头上**。如有确实需要添加设计说明的，写入架构文档（如果有）或是告知用户，让用户决定。

### 3.1 函数头：只写用途

- 用 Doxygen 简写，只保留职责与入参语义。如有重要注释的内容比如平台注册，开发时需要提醒的信息，则brief下面写。举例：

```c
/**
 * @brief 新 STA 关联入口（连接时调度，第一层），供平台驱动关联事件调用。
 *
 * @param sta_addr STA link MAC
 * @param band     关联频段 BAND_2G / BAND_5G
 * @param rssi     关联时的 RSSI（dBm）
 */
void roam_engine_on_new_sta_assoc(roam_engine_t *eng, const uint8_t *sta_addr, uint8_t band, int8_t rssi)
```
```c
/**
 * @brief 驱动遍历刷新sta信息（rssi），
 * get_clients 由平台层实现，需要对接
 * 
 * @return int 返回成功刷新的 STA 数。
 */
```

- 静态辅助函数用极简“//”注释，一句话即可：

```c
// 根据STA协议支持情况和RSSI情况决策是否启动roaming或bandsteering
static void gate_one_sta(roam_sta_t *sta, void *cookie)
```

- 头部**不要**罗列流程步骤、设计取舍、边界说明。需要说明的步骤一律下移到函数体内对应行。设计取舍等属于设计说明的一部分，如本章开头处理。

### 3.2 函数体内：行内注释贴在「被解释的那一行」

- 行级说明用 `//`，放在语句**末尾**或**独立一行**紧跟该逻辑之前。
- 中文、简短、动宾结构，只解释这行是干什么的，尽量简短，严禁解释函数功能设计逻辑/理由，如”因为要xxxx““文档xxxx行限制”等。

```c
sta->kv_support = KV_NONE;              // 默认无能力
sta->lifecycle.state = STA_LIFE_ACTIVE; // 启动 ACTIVE 监控

// 检查读取sta协议支持情况
if (eng->ops && eng->ops->probe_capabilities)
    eng->ops->probe_capabilities(sta, 0);

if (sta_htab_insert(eng->sta_table, sta) != 0) { // 哈希表失败回滚
    free(sta);
    return;
}
```

- 任务传入值有必要说明含义的，多条件判断逐项标注，便于审阅和后续维护：

```c
if (sta->kv_support >= KV_PARTIAL
    && band == BAND_2G          //2g激活
    && !sta->mlo_support        //仅不支持mlo设备触发连接时频段引导
    && wim->bandsteering_enable // 功能已使能
    && rssi > NEW_STA_ASSOC_RSSI_THRESHOLD) {
```

- 结构体字段/宏的语义注释放声明同行，两行并列时需要对齐：

不需要对齐：
```c
uint8_t addr[MAC_LEN]; // link MAC（当前关联频段 MAC）
int8_t  rssi;
sta_kv_capability_t kv_support; // 协议能力支持标识
```

需要对齐：
```c
int8_t  rssi;
uint8_t addr[MAC_LEN];          // link MAC（当前关联频段 MAC）
sta_kv_capability_t kv_support; // 协议能力支持标识
```

### 3.3 分节注释：仅用于代码段落归类

仅出现于文件级，不在函数顶上使用分节注释描述函数具体逻辑。

反例（禁止）：
```c
/*
 * 新 STA 关联入口。
 * 流程（严格对齐文档）：
 *   1. STA 已存在 → 防重复……
 *   2. 创建节点 + 能力探测……
 *   3. 连接时决策……
 * 说明：
 *   - 连接时只做 BandSteering……
 * 返回：无
 */
void roam_engine_on_new_sta_assoc(...)   // ← 出现设计有关字样，内容完全是解释代码，禁止
```

正确示例：
```c
/**
 * @brief 新 STA 关联入口（连接时调度，第一层），供平台驱动关联事件调用。   ← 简洁描述函数功能，不解释函数内部逻辑
 *
 * @param sta_addr STA link MAC
 * @param band     关联频段 BAND_2G / BAND_5G
 * @param rssi     关联时的 RSSI（dBm）
 */
void roam_engine_on_new_sta_assoc(roam_engine_t *eng, const uint8_t *sta_addr, uint8_t band, int8_t rssi)
{
    roam_sta_t *sta;
    struct wifi_setting_wim *wim;
    uint32_t now;

    if (!eng || !sta_addr)
        return;
    wim = eng->wim;
    now = get_time_sec();

    // 新sta触发hashtable动作    ← 逻辑解释
    sta = sta_htab_find(eng->sta_table, sta_addr);
    if (sta) {
        sta->rssi = rssi;
        sta->lifecycle.last_seen = now;
    } else {
        sta = calloc(1, sizeof(*sta));
        if (!sta)
            return;
        memcpy(sta->addr, sta_addr, MAC_LEN);
        sta->current_band = band;
        sta->rssi = rssi;
        sta->active_sm = SM_NONE;
        sta->kv_support = KV_NONE;              // 默认无能力      ← 逻辑解释
        sta->lifecycle.state = STA_LIFE_ACTIVE; // 启动 ACTIVE 监控
        sta->lifecycle.last_seen = now;
        init_rrm_queue(&sta->rrm_rep_queue);

        // 检查读取sta协议支持情况     ← 逻辑解释
        if (eng->ops && eng->ops->probe_capabilities)
            eng->ops->probe_capabilities(sta, 0);

        if (sta_htab_insert(eng->sta_table, sta) != 0) { // 哈希表失败回滚   ← 逻辑解释
            free(sta);
            return;
        }

        if (sta->kv_support >= KV_PARTIAL
            && band == BAND_2G          //2g激活   ← 功能解释
            && !sta->mlo_support        //仅不支持mlo设备触发连接时频段引导   ← 功能解释
            && wim->bandsteering_enable // 功能已使能   ← 功能解释
            && rssi > NEW_STA_ASSOC_RSSI_THRESHOLD) {
            sta->active_sm = SM_BANDSTEER;
            bandsteer_sm_init(&sta->bandsteer_sm, sta, wim);
            bandsteer_sm_handle_event(&sta->bandsteer_sm, EV_NEW_STA_ASSOC, NULL);
        }
    }
}
```

正确做法总结：头部只留 `@brief` 一句，把上述内容拆分到函数内每一步的行旁。

---

## 控制流风格

1. 「查找→不存在则新建」这类兜底逻辑尽可能用 `if / else` 表达，语义直白、方便维护：

```c
// 新sta触发hashtable动作
sta = sta_htab_find(eng->sta_table, sta_addr);
if (sta) {
    // 已存在：只刷新活跃性
    sta->rssi = rssi;
    sta->lifecycle.last_seen = now;
} else {
    // 新建节点
    sta = calloc(1, sizeof(*sta));
    if (!sta)
        return;
    ...
}
```

2. 状态机 `switch(state)` 内每个 `case` 用行内注释标注该状态下处理的动作语义，不另起一行，节约行数。如 `case SM_ROAM: // 漫游任务` 而不是

```c
case SM_ROAM: 
// 漫游任务
```

3. 周期 tick / 定时器回调等入口，注释直接写明控制意图：

```c
if (now_ms - eng->last_rssi_poll >= RSSI_POLL_INTERVAL_MS) { // 核心周期任务：rssi决定是否触发漫游/频段引导
    eng->last_rssi_poll = now_ms;
    do_rssi_poll_and_gate(eng);
}
```
## 代码实现风格
- 不做毫无必要的抽象，只有一行代码但多处需要用到的的内容，除非语义上也应该独立，否则直接多写几遍，不得用函数替代。

如下，禁止一行return也抽象为函数的行为。
```c
/**
 * @brief 取当前频段的对应目标频段。
 *
 * @param cur_band 当前频段 BAND_2G / BAND_5G
 * @return uint8_t 目标频段
 */
uint8_t bandsteer_decide_target_band(uint8_t cur_band)
{
    return (cur_band == BAND_2G) ? BAND_5G : BAND_2G;
}
```
---

## 接口头文件

- 对外接口在 `.h` 中给出**用途 + 参数**，只写调用方所需信息：

```c
/*
 * 新 STA 关联时触发，需要对接到平台驱动。
 * 由平台层在收到「STA 关联」事件（或首次出现在 get_clients）时调用。
 *   sta_addr：STA link MAC
 *   band    ：BAND_2G / BAND_5G
 *   rssi    ：关联时的 RSSI（dBm）
 */
void roam_engine_on_new_sta_assoc(roam_engine_t *eng, const uint8_t *sta_addr, uint8_t band, int8_t rssi);
```

- 实现细节、内部流程不写进 `.h`。

## 编译验证

**用户自主验证，不得直接尝试探测编译环境来启动编译**