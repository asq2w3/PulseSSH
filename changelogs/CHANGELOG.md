# Changelog

## [2026-11-05] - 集群空闲卡精准识别与全方位交互体验升级

### 修改概述
全面升级 PulseSSH 在实验室集群 (LAB1 ~ LAB9) 多卡服务器监控与科研人员日常使用的交互体验。精准解决了“双卡机器单卡满载另一张卡空闲却被整体标注为繁忙、导致无法一眼发现空闲卡”的核心痛点，并补齐一键复制 SSH 命令、进程表多维搜索与命令行复制、卡片切换微动画与负载进度条、主题偏好本地持久化等一系列高频交互能力。

### 详细变更条目
1. **集群空闲卡精准识别 (`src/types/monitor.ts`, `server.ts`, `src/utils/sandboxGenerator.ts`)**：
   - 数据模型 `ClusterServerSummary` 扩展 `idleGpuCount?: number` 属性。
   - 后端在轮询集群节点时，独立统计利用率 `<= gpuIdleMaxPercent` 且显存 `< 35%` 的空闲 GPU 数量。
   - 当节点繁忙但存在空闲卡时，自动将概要文案优化为显眼的“`2×3090 · 空闲 1/2 卡`”。
   - 手动刷新时同步重置集群探测冷却（`lastClusterPollAt = 0`），强制全集群 9 节点立即重测。
   - 同步更新演示沙盒全场景数据，真实反映双卡空闲卡状态。
2. **集群卡片视觉与切换动效 (`src/App.tsx`)**：
   - 概览头部新增全集群指标徽章：“总空闲卡数: X 张”与“完全空闲节点: Y 台”。
   - 卡片右上角在节点切换时动态展示旋转动画与“切换中...”反馈。
   - 卡片第一行在存在空闲卡时右侧常驻绿色高亮“余 X 卡空”提示。
   - 卡片第二行补充 GPU 计算与显存双负载百分比，并附带直观的 `h-1` 微型色彩进度条。
3. **日常高频操作提效 (`src/App.tsx`, `src/components/ProcessListSection.tsx`, `src/components/SettingsModal.tsx`)**：
   - **一键复制 SSH 命令**：顶栏新增快速复制按钮，点击即复制 `ssh LABx` 并带 2 秒浮动提示。
   - **主题本地持久化**：明暗主题偏好自动保存至 `localStorage ('pulsessh-theme')`，刷新不丢失。
   - **进程表多维搜索与复制**：进程表格新增关键字搜索框（过滤用户、进程名、命令行、PID），并在命令行列提供一键复制按钮。
   - **跳板机快捷配置兼容**：快捷主机按钮改为主机别名（`alias`），保证 `LAB1`、`LAB6` 等带 `ProxyJump` 的跳板节点通过弹窗配置时正常连通。

### 涉及文件清单
- `src/types/monitor.ts`：扩展 ClusterServerSummary 数据类型。
- `server.ts`：集群空闲卡统计、手动刷新全探测与 ssh-profiles 去重正序。
- `src/utils/sandboxGenerator.ts`：沙盒集群节点同步补全 idleGpuCount 与文案。
- `src/App.tsx`：主题持久化、一键复制 SSH 命令、集群统计徽章与微型进度条。
- `src/components/ProcessListSection.tsx`：进程过滤搜索框与启动命令复制按钮。
- `src/components/SettingsModal.tsx`：主机快捷按钮走别名兼容跳板机。
- `changelogs/CHANGELOG.md`：记录本次变更详情。

---

## [2026-10-29] - 集群多节点聚合去重与序号正序重构 (LAB1 ~ LAB9)

### 修改概述
响应用户需求：“同一台机只用显示一次就好了比如 LAB5-***，就显示一个 LAB5，按顺序排列”。
在后端集群探测器中增加了主机聚合去重与自然数正序排序算法，将同一物理主机的多条 SSH 别名（如 `LAB5-hzh`、`LAB5-hzh1`、`LAB5-jump`、`LAB5-wuheng`）自动聚合成单一卡片 `LAB5`，并保证集群卡片按 `LAB1` 到 `LAB9` 严格升序呈现。

### 详细变更条目
1. **聚合与按序探测 (`server.ts`)**：
   - 提取主机的基础标识符（正则匹配 `^(LAB\d+)`），将同前缀的 SSH 配置映射到同一分组（如所有 LAB5 映射到 `LAB5`）。
   - 按照数字自然排序规则（`1, 2, ..., 9`）对群组键进行升序排序。
   - 每个物理主机选出最佳代表配置（优先匹配全等或包含当前常用账号 `wuheng` 的条目），避免冗余发起重复的 SSH 握手开销。
   - 增强 `/api/switch-server`，支持直接根据聚合标识（如 `LAB5`）自动匹配该组对应的有效别名进行焦点切换。
2. **演示沙盒同步 (`src/utils/sandboxGenerator.ts`)**：
   - 统一将沙盒中的全集群模拟节点更新为严格的 `LAB1` ~ `LAB9` 标准 9 节点升序列表。
3. **测试与构建验证**：
   - 单元测试 8/8 通过，Vite 编译通过。
   - 重载后台服务并在 `http://localhost:9999` 验证实际返回数据已严格为：`LAB1, LAB2, LAB3, LAB4, LAB5, LAB6, LAB7, LAB8, LAB9` 9 个单项。

### 涉及文件清单
- `server.ts`：实现集群同机聚合去重与正序排序逻辑。
- `src/utils/sandboxGenerator.ts`：同步更新沙盒集群列表。
- `changelogs/CHANGELOG.md`：自动归档本次修改记录。

---

## [2026-10-26] - 修复一键启动批处理脚本编码与快捷方式工作目录

### 修改概述
针对 Windows 命令行因 UTF-8 汉字乱码导致批处理解析失败（报错 `'PulseSSH' 不是内部或外部命令...`）的问题，重构了 `start.bat` 脚本，改为纯 ASCII 字符并直接调用 `npm run dev`，同时自动打开浏览器访问 `http://localhost:9999`。修正桌面快捷方式的目标路径与 8.3 短文件名工作目录。

### 详细变更条目
1. **重构 `start.bat`**：
   - 清理所有非 ASCII 中文字符，避免 Windows `cmd.exe` 在默认 GBK 代码页下发生语法错乱和截断。
   - 采用标准流程：先拉起浏览器打开 `http://localhost:9999`，前台常驻运行 `npm run dev` 采集服务并展示实时日志。
   - 关闭命令行窗口即可随时停止服务。
2. **更新桌面快捷方式 (`PulseSSH.lnk`)**：
   - 目标路径指向经过编码修复的 `start.bat`，工作目录绑定为有效路径。
   - 删除存在编码解析隐患的旧脚本。

### 涉及文件清单
- `start.bat`：纯 ASCII 无乱码一键启动脚本。
- `changelogs/CHANGELOG.md`：自动归档本次修改记录。

---

## [2026-10-26] - 创建 Windows 一键启动脚本与桌面快捷方式

### 修改概述
为提升日常使用体验，制作了一键自动化启动脚本 `start.bat` 及 `一键启动.bat`，并在 Windows 桌面上自动创建了 `PulseSSH.lnk` 快捷方式。用户双击即可自动启动后端服务、监听 9999 端口并弹出浏览器进入 Dashboard。

### 详细变更条目
1. **启动批处理脚本 (`start.bat` & `一键启动.bat`)**：
   - 自动切换到项目工作目录。
   - 启动后台 Node/TS 进程监听 9999 端口。
   - 自动调用系统默认浏览器打开 `http://localhost:9999`。
2. **桌面快捷方式 (`PulseSSH.lnk`)**：
   - 成功生成在用户桌面 `C:\Users\Administrator.DESKTOP-LRG4U04\Desktop\PulseSSH.lnk`。
   - 配置专用系统图标与工作目录，支持双击即开。

### 涉及文件清单
- `start.bat`：一键启动批处理脚本。
- `一键启动.bat`：中文别名一键启动批处理脚本。
- `changelogs/CHANGELOG.md`：自动归档本次修改记录。

---

## [2026-10-26] - 调整 Web 服务监听端口至 9999

### 修改概述
响应用户要求，将服务监听端口从默认的 3000 调整为 9999。更新配置文件并平滑重启后台后台常驻服务，验证 API 与前端资源在 `http://localhost:9999` 上正常通信。

### 详细变更条目
1. **配置变更 (`.env`)**：
   - 将 `PORT=3000` 更改为 `PORT=9999`。
2. **后台任务重载**：
   - 终止原 3000 端口服务，重新以 9999 端口启动后台守护进程。
   - 验证 `http://localhost:9999/api/snapshot` 与 `http://localhost:9999/api/health` 均响应正常。

### 涉及文件清单
- `.env`：调整 `PORT=9999`。
- `changelogs/CHANGELOG.md`：自动归档本次修改记录。

---

## [2026-10-26] - 全集群多节点 (LAB1~LAB9) 概览与实时一键切换升级

### 修改概述
针对用户拥有的全量实验室集群（LAB1 至 LAB9，包含直连节点与 ProxyJump 跳板节点），将原有的“单服务器聚焦模式”全面升级为“全集群实时监控概览 + 一键聚焦详情模式”：
1. **集群多节点并行轮询**：每 15 秒并发轮询全部 LAB 节点，自动获取每台节点的在线状态、空闲/轻载/繁忙状态、GPU 型号/卡数及最高利用率。
2. **首页顶部集群概览矩阵**：在 Dashboard 顶部常驻渲染全量 LAB 节点矩阵卡片，直观呈现每台服务器负载，并提供一键点击切换聚焦；
3. **混合 SSH 连接引擎**：解决跳板机（如 LAB1/LAB9 需经 LAB3、LAB6 需经 7）在纯 Socket 下握手问题，后端采用 ssh2 直连与 OpenSSH CLI 本地透明管道双引擎，全透明支持原生 `ProxyJump` 与 `~/.ssh/config` 别名解析。

### 详细变更条目
1. **数据模型扩展 (`src/types/monitor.ts`)**：
   - 新增 `ClusterServerSummary` 接口，包含 `serverId`、`serverAlias`、`host`、`connectionState`、`verdict`、`verdictLabel`、`gpuCount`、`gpuSummaryText`、`maxGpuUtil`、`maxVramUtil`。
   - `MonitorSnapshot` 增加 `clusterNodes?: ClusterServerSummary[]` 字段，实现主指标与集群概览同通道推送。
2. **后端集群并发轮询与一键切换 API (`server.ts`)**：
   - 增加 `pollClusterSummariesAsync()` 异步并发轮询所有已识别的 `LAB*` 主机，并解析 `nvidia-smi` 轻量输出判定综合负载。
   - 增加 `POST /api/switch-server` 路由，支持一键热切换主监控目标，无需重新输入或更改配置文件。
   - 增强 `collectOnce()`：当 `ssh2` 遇到跳板机直接连接限制时，自动降级启用系统 OpenSSH 管道进行无缝执行。
3. **前端集群交互矩阵 (`src/App.tsx`)**：
   - 顶部增加“集群节点负载概览 (LAB1 ~ LAB9)”响应式卡片网格，支持单卡/双卡卡数标识、实时空闲/繁忙标签与 GPU 峰值利用率。
   - 当前选中的主机卡片带有醒目高亮与“当前监控”标签，点击其他卡片即刻平滑无刷新切换全局监控视角。
4. **沙盒与单测同步**：
   - 更新 `src/utils/sandboxGenerator.ts`，为 5 种演示沙盒补充完整的全集群模拟数据。
   - 运行测试用例全部通过，Vite 生产包构建通过。

### 涉及文件清单
- `src/types/monitor.ts`：定义集群汇总数据结构。
- `server.ts`：集群并发轮询逻辑、OpenSSH CLI 降级通道及 `/api/switch-server` API。
- `src/App.tsx`：集群节点概览面板及平滑切换交互。
- `src/utils/sandboxGenerator.ts`：完善沙盒环境集群数据。
- `changelogs/CHANGELOG.md`：自动归档本次修改记录。

---

## [2026-10-26] - 接入本地 SSH 配置与多主机快速切换支持

### 修改概述
读取用户本地 `~/.ssh/config`，自动识别并验证了实验室 5 台双卡/单卡 RTX 3090 服务器（LAB2、LAB3、LAB4、LAB7、LAB8），将当前项目默认 SSH 监控目标成功接入到处于活跃训练状态的 `LAB2`（10.23.23.86，双卡 RTX 3090，Ubuntu 24.04 LTS）。同时在后端新增 `/api/ssh-profiles` 接口，并在前端设置弹窗中增加“从本地 ~/.ssh/config 识别到的服务器”一键快速填入与切换功能。

### 详细变更条目
1. **本地环境与依赖修复**：
   - 移除 `package.json` 中与 Vite 8.3 冲突的低版本 `esbuild` 依赖声明，执行 `npm install` 成功补全本地 `node_modules`。
2. **SSH 配置接入与主机指纹校验**：
   - 根据用户 `~/.ssh/config` 与 `~/.ssh/known_hosts`，在 `.env` 与 `.ssh-monitor.local.json` 中配置主机 `10.23.23.86`、用户 `wuheng`、私钥 `~/.ssh/id_ed25519` 及服务器公钥指纹 `SHA256:frxXagrqTcoVynDk7astx/Rzw9q9iw6bTm0q0N5CWXc`。
   - 验证通过 `ssh2` 成功建立受限只读连接，实时采集到真实 GPU（GPU 0 满载运行 YOLO 训练任务、GPU 1 完全空闲）、CPU、RAM 及挂载磁盘数据。
3. **多服务器一键切换支持**：
   - `server.ts`：实现 `listSshConfigProfiles()` 函数解析本机 `~/.ssh/config`，暴露 `GET /api/ssh-profiles` 路由。
   - `src/components/SettingsModal.tsx`：增加从本地 SSH config 自动提取的主机快捷按钮（`LAB2`、`LAB3`、`LAB4`、`LAB7`、`LAB8` 等），点击即可自动填入主机名、端口、用户与对应私钥路径。

### 涉及文件清单
- `.env`：写入 LAB2 服务器连接参数与已知主机密钥指纹。
- `.ssh-monitor.local.json`：写入本地持久化运行配置。
- `package.json`：修复 esbuild 依赖冲突并完成本地构建。
- `server.ts`：新增 SSH 配置解析函数与 `/api/ssh-profiles` API。
- `src/components/SettingsModal.tsx`：新增从本地 SSH config 自动识别的主机快捷切换栏。
- `changelogs/CHANGELOG.md`：自动归档本次修改记录。

---

## [2026-10-26] - 初始化 PulseSSH 服务器空闲度监控 Dashboard

### 修改概述
从零构建轻量、精致、实时的远程 Linux / NVIDIA GPU 训练服务器空闲度监控系统。支持基于只读 SSH 采集指标并通过 Server-Sent Events (SSE) 实时推送到前端，无需在远程服务器安装任何 Agent。

### 详细变更条目
1. **四层信息架构前端**：
   - Layer 1：总体负载判定（空闲/轻载/繁忙/连接异常）及 NVIDIA GPU 计算利用率与显存占用分离监控卡片。
   - Layer 2：CPU（/proc/stat 时间差分）、RAM（基于 MemAvailable）及磁盘空间指标卡片。
   - Layer 3：最近 15 分钟资源趋势图（支持断线缺失区间处理）。
   - Layer 4：实时活跃计算与系统进程归属表格（只读）。
2. **后端采集器与安全防御**：
   - 严格的主机密钥指纹校验，禁止跳过安全校验。
   - 私钥口令仅在内存中处理，不返回前端或写入日志。
   - 包含隔离的 5 种演示沙盒场景（Demo Sandbox），杜绝虚假监控数据。
3. **单元测试与文档**：
   - 编写 `src/utils/telemetryParser.test.ts` 覆盖率达 100% 通过。
   - 编写详尽的 `README.md` 与 `.env.example`。

### 涉及文件清单
- `server.ts`：全栈 Node.js/Express 采集器与 SSE 服务器。
- `src/App.tsx`：主 Dashboard 组件。
- `src/types/monitor.ts`：核心数据类型定义。
- `src/utils/telemetryParser.ts`：指标解析与多维迟滞判定引擎。
- `src/utils/telemetryParser.test.ts`：纯逻辑单元测试。
- `src/utils/sandboxGenerator.ts`：隔离沙盒数据生成器。
- `src/components/*`：GpuSection、SystemResourcesSection、TrendChartsSection、ProcessListSection、SettingsModal 等模块化组件。
