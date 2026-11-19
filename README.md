# PulseSSH · SSH 服务器空闲度监控 Dashboard

简洁、精致、实时的远程 Linux / NVIDIA GPU 深度学习训练服务器空闲度监控 Web 应用。

专为“本地 Windows 开发 + 远程 Ubuntu 训练服务器”工作流设计：浏览器访问本地 Web 界面，本地 Node.js 后端复用单条受限只读 SSH 连接定时采集远程服务器指标并通过 Server-Sent Events (SSE) 实时推送给前端，**无需在远程服务器部署任何常驻 Agent、Docker 容器或数据库**。

---

## 一、核心特性

1. **三秒回答核心问题**：
   - **服务器现在是否正常？** 顶部实时展示在线状态、SSH 连接状态、最近成功采集时间与持续监控时长。
   - **GPU、显存和其他核心资源是否空闲？** 结合最近多个采样周期的平滑均值与 3% 迟滞缓冲（Hysteresis）判定 **空闲 / 轻载 / 繁忙 / 连接异常**，并将 **GPU 计算核心利用率** 与 **显存占用 (VRAM)** 明确分离显示（避免将“显存驻留但无算子计算”误判为完全空闲或满载计算）。
   - **目前是谁在占用资源？** 自动关联 `nvidia-smi` 计算进程与 `ps` 系统进程，展示占用 GPU 显存与 CPU 的 PID、用户名、显存占用、运行时长及启动命令。
2. **科学的 Linux 指标计算**：
   - **CPU 利用率**：基于 `/proc/stat` 前后两次采样计数的时间差（Delta）计算，绝不将累计计数直接当作瞬时利用率。
   - **系统内存**：优先依据 `/proc/meminfo` 中的 `MemAvailable` 计算实际可用内存，避免把可随时回收的 Page Cache 误判为不可用内存。
   - **磁盘空间**：基于 `df -B1 -P` 自动过滤 `tmpfs`/`squashfs`/`overlay` 等虚拟挂载点。
3. **严格的安全性与边界**：
   - **强制主机密钥校验**：支持校验本地 `~/.ssh/known_hosts`（含 OpenSSH 哈希格式 `|1|...`）或固定服务器公钥 `SHA256` 指纹，**禁止无条件跳过主机指纹校验**。
   - **凭证零泄露**：SSH 私钥与口令仅由本地后端读取，绝不返回给前端接口或写入普通日志。
   - **只读固定指令**：后端仅执行静态、只读的采集脚本，不向前端开放任意 Shell 命令执行接口，并对主机名、用户名、端口等配置参数做严格白名单校验，防止命令注入。
4. **真实监控与演示沙盒严格隔离**：
   - 默认运行于 **真实 SSH 监控模式**：未连接或断开时如实展示状态与最后更新时间，绝不用假数据填充。
   - 提供明确标注的 **演示沙盒模式**：内置“空闲”、“轻载·显存驻留”、“繁忙·分布式训练”、“无 NVIDIA GPU”、“SSH 异常拦截” 5 种预设场景，方便在未连接真实服务器时验证 UI 与阈值逻辑。

---

## 二、在 Windows 本地启动说明

### 1. 环境要求

- **Node.js**：建议使用 Node.js `v20+` 或 `v22+`
- **npm**：随 Node.js 附带
- **SSH 私钥或系统 OpenSSH Agent**：已配置好可免密登录远程 Ubuntu 服务器的公钥（`~/.ssh/authorized_keys`）

### 2. 安装与启动步骤

在 PowerShell 或 Windows Terminal 中进入项目目录：

```powershell
# 1. 安装依赖
npm install

# 2. 复制环境变量模板并按需修改
copy .env.example .env

# 3. 启动全栈服务（后端 SSH 采集 + 前端界面，默认监听 http://localhost:3000）
npm run dev
```

启动后在浏览器打开 `http://localhost:3000` 即可使用。

### 3. 其他常用脚本

```powershell
# 运行指标解析、CPU 差分、MemAvailable、阈值判定与安全校验单元测试
npm test

# TypeScript 类型检查
npm run lint

# 构建生产版本前端资源
npm run build
```

---

## 三、如何配置 SSH 连接

您可以通过以下任一方式配置 SSH 连接：

### 方式 A：通过本地 `.env` 文件配置（推荐）

编辑项目根目录下的 `.env` 文件：

```ini
SSH_SERVER_ALIAS="Ubuntu-4090-Node"
SSH_HOST="192.168.1.100"
SSH_PORT=22
SSH_USERNAME="ubuntu"
SSH_AUTH_METHOD="privateKeyPath"
# Windows 路径示例：C:\Users\YourName\.ssh\id_ed25519 或 ~/.ssh/id_ed25519
SSH_PRIVATE_KEY_PATH="~/.ssh/id_ed25519"
SSH_PASSPHRASE=""

# 主机密钥校验策略：known_hosts 或 pinned_fingerprint
SSH_HOST_KEY_POLICY="known_hosts"
SSH_KNOWN_HOSTS_PATH="~/.ssh/known_hosts"
SSH_HOST_FINGERPRINT=""
```

### 方式 B：通过 Web 界面配置窗口

1. 点击右上角 **“连接与阈值配置”** 按钮。
2. 填写服务器别名、主机 IP（或 `~/.ssh/config` 中定义的 Host 别名）、用户名、端口及本地私钥文件路径。
3. 保存后配置将写入本地 `.ssh-monitor.local.json`（已加入 `.gitignore`，且不落盘保存口令），并立即建立连接。

---

## 四、远程 Ubuntu 服务器端所需命令与权限说明

本应用**不需要**在远程 Ubuntu 服务器安装任何额外监控组件或 root 权限，只需普通 SSH 登录用户具备以下基础只读访问能力：

1. **基础系统指标（所有标准 Ubuntu 系统自带）**：
   - `/proc/stat`、`/proc/loadavg`、`/proc/meminfo`、`/proc/uptime`、`/proc/cpuinfo`
   - 基础命令：`hostname`、`nproc`、`df`、`ps`
2. **NVIDIA GPU 监控（具备 NVIDIA 显卡的服务器）**：
   - 需要已安装 NVIDIA 显卡驱动并包含 `nvidia-smi` 命令（通常位于 `/usr/bin/nvidia-smi`）。
   - 如果页面提示 **“无权限访问 NVIDIA GPU 指标 (NVML Insufficient Permissions)”**，请在远程 Ubuntu 服务器将当前用户加入 `video` 或 `render` 组，或由管理员开启驱动性能计数器权限：
     ```bash
     sudo usermod -aG video,render $USER
     ```

---

## 五、常见连接错误排查方法

| 错误码 | 现象说明 | 排查与恢复步骤 |
| :--- | :--- | :--- |
| `HOST_KEY_UNVERIFIED` | 服务器公钥尚未在 `~/.ssh/known_hosts` 中记录 | 1. 在本地终端执行一次 `ssh user@host` 确认指纹并写入 `known_hosts`；或<br>2. 核对错误卡片中显示的 `SHA256:...` 指纹无误后，点击 **“信任并固定此 SHA256 指纹”**。 |
| `HOST_KEY_MISMATCH` | 服务器公钥与本地记录不一致 | 请核实远程服务器是否重装过系统或更改了端口映射；确认安全后清理旧 `known_hosts` 记录或更新固定指纹。 |
| `PRIVATE_KEY_ERROR` | 私钥文件不存在、无读取权限或口令错误 | 检查 `SSH_PRIVATE_KEY_PATH` 路径是否正确；若私钥带加密口令，请在配置中填入 Passphrase 或改用 `agent` 模式。 |
| `AUTH_FAILED` | 用户名或公钥被服务器拒绝 | 确认 `SSH_USERNAME` 正确，且远程服务器 `~/.ssh/authorized_keys` 权限为 `600`、`~/.ssh` 目录权限为 `700`。 |
| `NETWORK_UNREACHABLE` | 网络不可达或连接被拒绝 | 检查是否已连接实验室/内网 VPN，确认服务器 IP 与端口（默认 22）可连通。 |
| `COMMAND_TIMEOUT` | 连接或监控命令执行超时 | 远程服务器可能处于极高磁盘 I/O 阻塞或网络丢包严重，系统将自动按指数退避重连，也可点击“立即重试采集”。 |

---

## 六、多机集群概览与一键启动指南

1. **自动识别本地 `~/.ssh/config` 集群**：
   - 系统会自动解析本机 `~/.ssh/config` 中的 `LAB*` 节点（支持 `ProxyJump` 跳板机与直连主机），对同一物理机器的多条别名自动聚合去重并按序号正序排列。
   - 顶部**集群概览矩阵**实时展示每台服务器的在线状态、空闲 GPU 卡数（`余 X 卡空`）、最高计算利用率与显存水位，点击任意卡片即可一键切换详情视图。
2. **Windows 一键启动**：
   - 配置好 `.env`（默认端口 `PORT=3000`，可按需修改为如 `9999`）后，直接双击项目根目录下的 `start.bat` 即可自动启动后台服务并打开浏览器。
3. **进程筛选与快捷操作**：
   - 支持在活跃进程表中按用户名、PID 或脚本关键字实时过滤，并可一键复制完整训练命令或 `ssh <节点>` 登录指令。
