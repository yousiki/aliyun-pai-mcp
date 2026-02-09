# aliyun-pai-mcp（PAI DLC + Code Builds）PLAN / SPEC（TS + Bun）

版本：v0.3（根据你最新反馈重构：单实例=单 Project，settings 极简，DLC-only，Code Builds 作为代码分发）

---

## 0. 目标与约束（必须先对齐）

### 0.1 目标（MUST）

1. 通过 MCP 让 coding agent 能与阿里云 PAI-DLC（分布式训练）交互，实现：

- 提交训练任务（CreateJob）
- 列出当前项目任务（ListJobs）
- 查看任务详情/状态（GetJob）
- 停止任务（StopJob）
- 拉取任务节点日志（GetPodLogs）
  （这些 API 在 PAI-DLC OpenAPI 概览中明确存在。）:contentReference[oaicite:0]{index=0}

2. 通过 Code Builds / CodeSource 体系维护代码分发，使 workflow 变成：

- 本地 coding → git commit/push
- MCP 调用更新 CodeSource 指向某个 branch/commit
- MCP 提交 DLC job，DLC 在启动前自动拉取代码并挂载到容器目录
  （CreateJob 的 CodeSource 机制描述了“自动下载代码并挂载”的行为。）:contentReference[oaicite:1]{index=1}

3. “一个 MCP Server 实例 = 一个 Project（也即一份 settings）”，所有 job/资源都用 `ProjectPrefix` 强隔离，并且 list/get/stop/logs 都只允许操作：

- `ShowOwn=true`（只看/只操作当前调用者的作业）
- `DisplayName` 以 `ProjectPrefix-` 开头的作业
  （ListJobs 支持 `ShowOwn`、`DisplayName` 等过滤字段。）:contentReference[oaicite:2]{index=2}

4. settings 中 mount 权限字段使用 **`ReadOnly` / `ReadWrite`**（按你要求统一用完整拼写）。

### 0.2 非目标（SHOULD NOT / OUT OF SCOPE）

- 不在 MCP 内做“复杂的多 RAM 账号/多 project 子账号权限体系”（你明确否决了）。
- 不暴露 DSW 相关功能（你倾向 DLC-only，本 spec 也按 DLC-only 设计）。
- 不让 agent 自己选择 mounts（固定由 settings 驱动），避免 agent “偷偷 RW”。

### 0.3 关键安全现实（必须写进 spec，避免误判）

- 只要 MCP server 运行环境里存在可读的 AccessKey/Secret（文件或环境变量），而 agent 也能在同一 OS/容器上下文执行任意命令，则 agent 终究可能绕过 MCP 直接调用 OpenAPI。
- 所以本项目的“安全提升”主要来自**部署隔离**：推荐把 MCP server 跑在 agent 无法读文件/无法执行 shell 的环境里（远端机、受限容器、单独账户/最小权限等）。
- 本 spec 的安全策略是：**减少暴露面 + 强过滤 + 只读输出 settings + 不提供 settings 修改工具给 MCP**。更高级的隔离手段（STS 临时凭证、远端服务化、网络 ACL）作为可选增强。

---

## 1. 参考事实（实现时必须遵循的官方行为）

1. CreateJob 支持 `UserCommand`、`JobSpecs`、`DataSources`（含 `MountPath`、`Uri`、`Options`、`MountAccess` 等字段）、以及 `CodeSource`（含 `CodeSourceId/Branch/Commit/MountPath`），并且会在 job 启动前自动下载并挂载 code。:contentReference[oaicite:3]{index=3}

2. JobSpecs 的结构由 `JobSpec` 描述，包含至少：`Type`、`Image`、`PodCount`、`EcsSpec`、`ResourceConfig`、以及可能的 `AssignNodeSpec` 等高级字段；不同 `JobType` 支持不同 role type（如 TFJob/PyTorchJob）。:contentReference[oaicite:4]{index=4}

3. PAI-DLC API 概览明确列出：CreateJob/DeleteJob/UpdateJob/StopJob/ListJobs/GetJob/GetPodLogs/ListEcsSpecs 等可用接口。:contentReference[oaicite:5]{index=5}

4. GetCallerIdentity 可以在无参数的情况下返回调用者身份，包含 `IdentityType`、`AccountId`、`UserId` 等；当调用者是 RAM user 时返回 RAM user 的 `UserId`（你关心的“数字 ID”可自动获取）。:contentReference[oaicite:6]{index=6}

5. AIWorkSpace 的 CreateCodeSource 可创建代码配置，字段包括 `WorkspaceId`、`DisplayName`、`CodeRepo`、`CodeBranch`、`CodeCommit`（commit 优先于 branch）、`MountPath`、`Accessibility`（PUBLIC/PRIVATE）；并声明该配置可在 DLC jobs 中引用。:contentReference[oaicite:7]{index=7}

6. Code Builds 的概念：它是可在不同 jobs 中复用的公共 AI 资产（你已在旧版 DLC 页面看到）。:contentReference[oaicite:8]{index=8}

---

## 2. 总体架构（TS + Bun）

### 2.1 进程形态

- `aliyun-pai-mcp init`：交互式初始化 settings（写入本地/容器内的 settings.json），并执行 doctor 检查（可选）。
- `aliyun-pai-mcp server`：启动 MCP Server（默认 stdio transport，适配 Claude Code / Codex / Cline 等常见 MCP client）。
- `aliyun-pai-mcp doctor`：不启动 MCP，仅检查鉴权、workspace 连通性、列举 prefix jobs 等。
- `aliyun-pai-mcp dump-job-specs`：**用于你提到的 JobSpecs 不确定问题**：从一个已存在 job 中提取 `JobType` + `JobSpecs` + 可能的 `ResourceId/镜像/EcsSpec`，输出 JSON 给你复制进 settings。

### 2.2 SDK/依赖（MUST）

- OpenAPI 调用：优先使用阿里云 V2 TypeScript SDK（Tea 风格），而不是 shell out 到 `aliyun cli`。
  - PAI-DLC TS SDK：`@alicloud/pai-dlc20201203`（OpenAPI SDK 中心给出 npm 包与版本信息）。:contentReference[oaicite:9]{index=9}
  - OpenAPI client 基础：`@alicloud/openapi-client`（npm 包存在且常用）。:contentReference[oaicite:10]{index=10}
  - AIWorkSpace TS SDK（用于 CodeSource/Code Builds）：从 AIWorkSpace SDK 中心拉取对应 TS SDK（同属 V2 体系）。:contentReference[oaicite:11]{index=11}
- 身份（UserId 自动化）：用 STS `GetCallerIdentity`（可直接请求，无参数）。:contentReference[oaicite:12]{index=12}

### 2.3 CLI 美化（SHOULD）

你希望像 opencode 那种“现代 CLI”，建议组合：

- 交互：`@clack/prompts`
- 彩色/格式：`picocolors` 或 `kleur`
- spinner：`ora`
- 表格：`cli-table3` 或 `console-table-printer`
- 日志：`pino` + `pino-pretty`（server 模式输出结构化，CLI 模式输出美观）

---

## 3. settings 设计（极简但可用）

### 3.1 文件位置与权限（MUST）

- 默认路径：`~/.config/aliyun-pai/settings.json`
- 可通过环境变量覆盖：`ALIYUN_PAI_SETTINGS_PATH=/path/to/settings.json`
- init 写入后强制 chmod 0600（Linux/macOS），避免意外泄露（容器内同理）。
- **MCP server 只读 settings**：MCP 工具不允许修改 settings 文件（防止 agent 通过 MCP 改权限）。

### 3.2 settings.json Schema（建议）

> 说明：你提出的字段保留为主；AccessKey 拆成 id/secret 是为了落地（OpenAPI 必需）。`userId` 改为 optional，因为可自动通过 STS 获取。:contentReference[oaicite:13]{index=13}

```jsonc
{
  "version": "0.3",
  "projectPrefix": "ysq-worldmodel",
  "regionId": "ap-southeast-1",

  // PAI / Workspace
  "workspaceId": "1234",
  "resourceId": "your-dlc-resource-id-or-cluster-id",

  // Credentials（建议默认存这里；也允许 env 覆盖）
  "credentials": {
    "accessKeyId": "AKIA...",
    "accessKeySecret": "****",
    // 可选：如果你未来用 STS 临时凭证，可以加 securityToken
  },

  // 可选：自动探测，不写也行
  "caller": {
    "accountId": null,
    "userId": null,
    "identityType": null,
  },

  // Code Builds / CodeSource（核心：DLC job 会自动下载并挂载 code）:contentReference[oaicite:14]{index=14}
  "codeSource": {
    "codeSourceId": "code-20********",
    "mountPath": "/root/code",
    "defaultBranch": "main",
    "defaultCommit": null,
  },

  // Job 默认配置（最小化：一个 jobType + 一个 jobSpecs 模板）
  "jobDefaults": {
    "jobType": "PyTorchJob",
    "displayNamePrefix": "ysq-worldmodel",

    // 方案 A（推荐）：直接存 jobSpecs 原始 JSON（最稳，完全贴合 OpenAPI）
    "jobSpecs": [],

    // 方案 B（可选）：如果 jobSpecs 还没搞清楚，就先用简单字段，后续 dump-job-specs 再切 A
    "simple": {
      "dockerImage": "your-image:tag",
      "ecsSpec": "ecs.gn7i-c8g1.2xlarge",
      "podCount": 1,
    },

    // 节点限制（你想要 allowedNodes）：具体字段要依赖 AssignNodeSpec 的结构，
    // 初版可以先不强行实现，或先把它当成“只允许选择这些节点”的逻辑约束（见 5.3）。
    "allowedNodes": [],
  },

  // Mounts：固定由 settings 决定，不允许 agent 在 submit 时自选
  "mounts": [
    {
      "name": "dataset",
      "uri": "oss://your-bucket/path/to/dataset/",
      "mountPath": "/mnt/dataset",
      "mountAccess": "ReadOnly",
      "options": null,
      "description": "训练数据集（训练时只读）",
    },
    {
      "name": "outputs",
      "uri": "oss://your-bucket/path/to/outputs/",
      "mountPath": "/mnt/outputs",
      "mountAccess": "ReadWrite",
      "options": null,
      "description": "训练输出（可写）",
    },
  ],
}
```

#### 3.2.1 mountAccess（按你要求）

- 只允许 `"ReadOnly"` 或 `"ReadWrite"`。

#### 3.2.2 DataSources 映射规则（MUST）

CreateJob 的 `DataSources` 是 array<object>，每项支持 `MountPath`、`Uri`、`Options`、`MountAccess` 等字段。([Alibaba Cloud][1])
server 必须将 settings.mounts 映射成 CreateJob 的 DataSources：

- `mountPath` → `MountPath`
- `uri` → `Uri`
- `options` → `Options`（文档提示目前 mount properties “仅 OSS 支持”，所以 options 先只对 OSS 打开）([Alibaba Cloud][1])
- `mountAccess` → `MountAccess`

> 备注：如果你们 CPFS 需要用 DataSourceId（NAS/CPFS 等），可扩展 mount item 支持 `dataSourceId`，与 `uri` 二选一。DataSourceItem 文档里提到 DataSourceType=nas（NAS 文件系统）([Alibaba Cloud][2])，但你们实际项目已有 CPFS 挂载，这块以你控制台能创建/挂载为准，先做成可扩展字段即可。

---

## 4. CLI 规格（给 human 用，不给 agent 用）

### 4.1 `init`（交互式）

目标：生成 settings.json（以及可选创建 codeSource）

流程：

1. 询问 `regionId`、`workspaceId`、`resourceId`、`projectPrefix`
2. 询问 AccessKeyId/AccessKeySecret（可选：允许用户选择只用 env，不落盘）
3. 自动调用 STS GetCallerIdentity，回填 caller 信息（accountId/userId/identityType）并打印（用于确认）。([Alibaba Cloud][3])
4. CodeSource：
   - 模式 1：用户输入已有 `codeSourceId`
   - 模式 2：用户输入 code repo/url + branch/commit + token → 调用 AIWorkSpace CreateCodeSource 创建，得到 `codeSourceId` 写入 settings。([Alibaba Cloud][4])

5. mounts：让用户录入 mount 列表（name/uri/mountPath/mountAccess/description，可选 options）
6. jobDefaults：
   - 先让用户选择 jobType（比如 PyTorchJob）
   - jobSpecs 先留空，但必须提示“如果 jobSpecs 为空，则 submit 会报错；请用 dump-job-specs 获取”。（见 4.3）

### 4.2 `doctor`

- 输出当前 settings 的关键字段（隐藏 secret）
- 请求：
  - STS GetCallerIdentity（验证凭证）([Alibaba Cloud][3])
  - PAI-DLC ListJobs（ShowOwn=true + DisplayName 前缀过滤）([Alibaba Cloud][1])

- 打印：
  - caller identity
  - 找到的 jobs 数量与前 5 条（displayName/status/jobId）

### 4.3 `dump-job-specs <jobId>`

> 这是为你第 2 点诉求量身定做：你会在实现过程中让 agent 给你一个命令拿到 JsonSpecs，然后你复制到 settings。

行为：

1. 调用 PAI-DLC GetJob(jobId)
2. 输出 JSON（stdout），至少包含：
   - `JobType`
   - `JobSpecs`（原样）
   - `CodeSource`（原样）
   - `DataSources`（原样）
   - `ResourceId`、`WorkspaceId`（若 GetJob 返回）

3. 同时提供一个“建议粘贴块”：仅 `jobDefaults.jobSpecs` 的 JSON 数组，方便你复制。

可用性说明：

- PAI-DLC API 概览明确 GetJob 存在，且 ListJobs/GetJob/StopJob/GetPodLogs 是典型闭环。([Aliyun Help Center][5])

---

## 5. MCP Server 规格（给 agent 用）

### 5.1 MCP 只暴露最小工具集（MUST）

不做 DSW，不做 settings 修改，不做 mounts 自选。

工具命名建议统一前缀：`pai_*`

#### Tool: `pai_whoami`

- 输入：无
- 输出：
  - accountId
  - userId
  - identityType
  - regionId/workspaceId

- 实现：STS GetCallerIdentity ([Alibaba Cloud][3])

#### Tool: `pai_mounts_list`

- 输入：无
- 输出：settings.mounts（隐藏敏感字段），让 agent 知道容器内路径怎么用。

#### Tool: `pai_codesource_get`

- 输入：无
- 输出：codeSourceId、mountPath、defaultBranch/defaultCommit

#### Tool: `pai_codesource_update`

- 输入：
  - `commit`（可选）
  - `branch`（可选）

- 输出：更新后的 codesource 摘要
- 实现：
  - 调用 AIWorkSpace UpdateCodeSource（API 存在于 AIWorkSpace 代码配置 API 列表中）([Aliyun Help Center][6])
  - 规则：如果传 commit，则更新 CodeCommit（commit 优先于 branch 的语义在 CreateCodeSource 中已明确；update 时也遵循同样意图）。([Alibaba Cloud][4])

> 说明：如果你们希望“每次提交都创建新的 code build”，也可以改成调用 CreateCodeSource 并返回新的 codeSourceId，但那会破坏“单 settings 固定 id”模型，所以不建议。

#### Tool: `pai_job_list`

- 输入：
  - `limit`（默认 20）

- 输出：当前 project 的 jobs 列表（jobId/displayName/status/createTime 等）
- 实现：
  - PAI-DLC ListJobs
  - 强制 `ShowOwn=true`
  - 强制 `DisplayName` filter = `${projectPrefix}-`（或你决定的规则）([Alibaba Cloud][1])

#### Tool: `pai_job_get`

- 输入：`jobId`
- 输出：GetJob 的关键信息（status、jobSpecs 摘要、pods 摘要等）
- 实现：PAI-DLC GetJob ([Aliyun Help Center][5])
- **强校验**：
  - displayName 必须以 `${projectPrefix}-` 开头，否则拒绝
  - 若 GetJob 返回 userId，则必须匹配当前 caller 的 userId（通过 STS 获取）；否则拒绝（防止跨人操作）([Alibaba Cloud][3])

#### Tool: `pai_job_submit`

- 输入（尽可能少）：
  - `name`：job 名称 suffix（最终 displayName = `${projectPrefix}-${name}-${yyyyMMddHHmmss}`）
  - `command`：UserCommand（启动命令）
  - `codeCommit`（可选）：本次 job 想用的 commit（如果传则覆盖 settings.codeSource.defaultCommit；也可先调用 `pai_codesource_update` 再 submit）

- 输出：jobId、displayName、dashboardUrl（如果 GetDashboard 可用可后续加）
- 实现：PAI-DLC CreateJob ([Aliyun Help Center][5])
  CreateJob 请求体构造规则：
  1. WorkspaceId = settings.workspaceId
  2. ResourceId = settings.resourceId
  3. DisplayName = `${projectPrefix}-${name}-${ts}`
  4. JobType = settings.jobDefaults.jobType
  5. JobSpecs：
     - 若 settings.jobDefaults.jobSpecs 非空 → 原样使用（方案 A）
     - 否则若 settings.jobDefaults.simple 存在 → 构造一个最小 Worker spec（方案 B，初版可选）
     - 否则：直接拒绝并提示用户运行 `dump-job-specs` 将 JSON 粘贴进 settings
       （JobSpecs/JobSpec 的概念和字段见官方 JobSpec 数据结构。）([Alibaba Cloud][7])

  6. UserCommand = 输入 `command` ([Alibaba Cloud][1])
  7. CodeSource：
     - CodeSourceId = settings.codeSource.codeSourceId
     - Commit/Branch/MountPath 按需填（CreateJob 的 CodeSource 字段存在且会自动下载并挂载 code）([Alibaba Cloud][1])

  8. DataSources = 由 settings.mounts 映射（MountPath/Uri/Options/MountAccess）([Alibaba Cloud][1])

#### Tool: `pai_job_stop`

- 输入：`jobId`
- 输出：stop 结果
- 实现：PAI-DLC StopJob（API 概览明确存在）([Aliyun Help Center][5])
- 校验同 `pai_job_get`

#### Tool: `pai_job_logs`

- 输入：
  - `jobId`
  - `role`（可选）
  - `index`（可选）
  - `tailLines`（默认 200）

- 输出：文本日志（stdout/stderr 合并或分段）
- 实现：PAI-DLC GetPodLogs（API 概览明确存在）([Aliyun Help Center][5])
- 选择 pod 的策略（建议）：
  1. GetJob，拿到 pods 列表（字段名以实际返回为准）
  2. 如果 role/index 指定，则定位 pod
  3. 否则默认选择“主节点/第一个 Worker”
  4. 调用 GetPodLogs 拉取日志并返回

#### Tool: `pai_job_wait`

- 输入：
  - `jobId`
  - `target`：`"Running" | "Terminal"`（默认 Running）
  - `timeoutSec`：默认 900
  - `pollSec`：默认 10

- 输出：最终 status + 最近一次 GetJob 摘要
- 实现：循环 GetJob 轮询（不做 sleep 太激进；遵守 pollSec）

### 5.2 所有 MCP tools 的输出必须做“去敏”

- 任何输出都不得包含 accessKeySecret / token / settings 全量内容
- settings 只允许输出 mounts、codesource 摘要、workspaceId/regionId 这类非敏信息

### 5.3 allowedNodes 的落地（你提出但不确定结构 → 先写成两阶段）

阶段 1（MUST，先能用）：

- 仅作为“逻辑约束”：如果 settings.allowedNodes 非空，则 server 在 submit 时检查 jobSpecs（或 simple）里是否包含某种 node 选择字段；若无法确认，则打印 warning：“allowedNodes 未生效（AssignNodeSpec 结构未配置）”。

阶段 2（可选增强）：

- 在你们拿到一份真实 jobSpecs 后，识别 `AssignNodeSpec` 的实际 JSON 结构，并在 submit 时强制写入，确保调度节点在 allowlist 内（JobSpec 确实存在 AssignNodeSpec 字段）。([Alibaba Cloud][7])

---

## 6. Agent 端推荐工作流（你想要的自动循环）

一个典型循环（给 Claude Code/Codex 的提示词可以按这个写）：

1. agent 本地改代码 → `git commit && git push`
2. agent 调用 `pai_codesource_update(commit=<HEAD>)`
3. agent 调用 `pai_job_submit(name="train", command="python /root/code/train.py --config ...", codeCommit=<HEAD>)`
4. agent 调用 `pai_job_wait(jobId, target="Running")`
5. agent 调用 `pai_job_logs(jobId, tailLines=200)` 看启动日志
6. 若报错：
   - agent 修复代码 → 回到步骤 1

7. 若正常训练：
   - agent 以一定间隔调用 `pai_job_logs` 或 `pai_job_get`，直到完成/失败

---

## 7. Docker 部署建议（强烈推荐，用于隔离 secret）

### 7.1 镜像目标

- `aliyun-pai-mcp` 一个镜像，包含二进制/脚本
- 支持 subcommand：
  - `aliyun-pai-mcp init`
  - `aliyun-pai-mcp server`

### 7.2 运行方式（建议）

- 把 settings 放在容器内 `/data/settings.json`
- 宿主机（或远端机）挂载 `/data` 目录
- 对 settings 挂载只读（如果你不需要容器内改 settings）

> 关键点：你的安全收益主要来自“agent 无法进入这个宿主机/容器执行命令”。本地 docker 只能算“轻微提高门槛”。

---

## 8. 验收标准（coding agent 实现完成后你如何验收）

1. `init` 生成 settings.json，chmod 正确，doctor 能通过，并能打印 caller userId（来自 STS）。([Alibaba Cloud][3])
2. `dump-job-specs <jobId>` 能输出可用的 JobSpecs JSON，你把它粘贴进 settings 后：
3. MCP `pai_job_submit` 可以成功创建 job（返回 jobId）
4. MCP `pai_job_list` 只返回 prefix + ShowOwn 的作业
5. MCP `pai_job_get` 对非 prefix jobId 必须拒绝
6. MCP `pai_job_logs` 能拿到日志（至少能拿到某个 pod 的 stdout/stderr）
7. MCP `pai_job_stop` 能停止 prefix job
8. 全流程输出不泄露 secret

---

## 9. 你需要补充/我需要你确认的点（仅剩不确定项）

A) `resourceId` 的来源与含义：你现在 UI 里看到的 ResourceId 是什么格式？（我会在实现里把它当成 CreateJob 必填字段透传）
B) CPFS mount 的 OpenAPI 表达方式：你们是通过 DataSourceId（NAS/CPFS）还是 Uri（cpfs://...）？

- 如果你能提供一个“控制台创建的 DLC job”的 GetJob 输出（脱敏），我就能把 mounts 映射写死得非常准。
  C) AssignNodeSpec 的真实 JSON：等你用 `dump-job-specs` 拿到一份真实 jobSpecs，我们就能把 allowedNodes 从“逻辑约束”升级成“强制注入”。

（你不需要现在回答 A/B/C 才能开始实现；实现可以先把这些做成可选字段和 TODO。）

---

[1]: https://www.alibabacloud.com/help/en/pai/developer-reference/api-pai-dlc-2020-12-03-createjob "https://www.alibabacloud.com/help/en/pai/developer-reference/api-pai-dlc-2020-12-03-createjob"
[2]: https://www.alibabacloud.com/help/en/pai/developer-reference/api-pai-dlc-2020-12-03-struct-datasourceitem "https://www.alibabacloud.com/help/en/pai/developer-reference/api-pai-dlc-2020-12-03-struct-datasourceitem"
[3]: https://www.alibabacloud.com/help/en/ram/developer-reference/api-sts-2015-04-01-getcalleridentity "https://www.alibabacloud.com/help/en/ram/developer-reference/api-sts-2015-04-01-getcalleridentity"
[4]: https://www.alibabacloud.com/help/en/pai/developer-reference/api-aiworkspace-2021-02-04-createcodesource "https://www.alibabacloud.com/help/en/pai/developer-reference/api-aiworkspace-2021-02-04-createcodesource"
[5]: https://help.aliyun.com/zh/pai/developer-reference/api-pai-dlc-2020-12-03-overview "https://help.aliyun.com/zh/pai/developer-reference/api-pai-dlc-2020-12-03-overview"
[6]: https://help.aliyun.com/zh/pai/developer-reference/api-aiworkspace-2021-02-04-overview "https://help.aliyun.com/zh/pai/developer-reference/api-aiworkspace-2021-02-04-overview"
[7]: https://www.alibabacloud.com/help/en/pai/developer-reference/api-pai-dlc-2020-12-03-jobspec "https://www.alibabacloud.com/help/en/pai/developer-reference/api-pai-dlc-2020-12-03-jobspec"

```

```
