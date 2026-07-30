# Protocol 安全在线数据库恢复设计

## 1. 范围与目标

本批只修复 SQLite 备份检查和数据库恢复链路。目标是让用户在 Protocol 仍然运行时恢复一个应用备份，并让现有后端连接立即读取恢复后的数据。

成功标准：

- 不再覆盖一个仍被 SQLite 打开的 `protocol.db` 文件。
- 选中的备份文件只读检查，不改变其 journal mode、内容或伴随文件。
- 检查生成任务拥有的一次性不可变预览；确认页显示原始源路径，但恢复只消费该预览，不会重新读取原路径。
- 恢复前必须创建并验证当前数据库的安全快照。
- 恢复失败时，当前数据库仍能通过同一个托管连接正常查询。
- 恢复成功后无需重启应用，数据管理页立即显示恢复后的统计。
- 旧版 Protocol 备份可复用现有迁移升级；高于当前支持版本的备份明确拒绝。
- 不新增 crate、npm 包或数据库迁移。

本批不处理：

- JSON 导出正确性；它使用下一份独立设计。
- 多实例限制、数据库加密、云同步或通用数据库导入。
- 修改 `PRAGMA user_version` 策略。
- 支持任意第三方 SQLite 文件或不同 page size 的在线转换。

## 2. 已确认的问题

`Database` 在整个 Tauri 进程中持有 `Mutex<Connection>`。当前恢复函数只释放了 `MutexGuard`，随后用 `fs::copy` 覆盖 `protocol.db`；真正的 SQLite 连接并未关闭。

这会产生四类问题：

1. Windows 通常拒绝覆盖仍被打开的数据库文件。
2. `fs::copy` 不是原子替换，I/O 中断可能留下部分文件。
3. 新主文件可能与旧连接缓存、`-wal` 和 `-shm` 状态不匹配。
4. 页面提示“重启”，但关闭主窗口只是隐藏到托盘，不会重建后端连接。

备份检查也以读写方式打开用户文件并执行 `PRAGMA journal_mode=DELETE`，同时吞掉部分 SQLite 查询错误。这既会修改被检查文件，也可能把损坏显示成“0 条记录”。

## 3. 方案决策

采用 SQLite Online Backup API，把经过隔离验证的 staging 数据库复制到当前托管连接。

`rusqlite 0.31` 已包含这层 API，只需把现有依赖功能从 `["bundled"]` 改为 `["bundled", "backup"]`。`backup` 是空 Cargo feature，不引入新 crate。

官方安全属性：

- backup 生命周期内，目标数据库持有写事务。
- `sqlite3_backup_step` 未完成时释放 backup 句柄，目标写事务会回滚。
- 目标连接在 backup 生命周期内不得被其他 API 使用。

现有 `Mutex<Connection>` 正好作为进程内串行化边界：恢复期间一直持锁，所有其他 Tauri 数据库命令等待，不会与恢复交错。

参考：

- <https://www.sqlite.org/c3ref/backup_finish.html>
- <https://www.sqlite.org/backup.html>
- <https://docs.rs/rusqlite/0.31.0/rusqlite/backup/>

## 4. 组件边界

### 4.1 数据库初始化

在 `src-tauri/src/db.rs` 中保留现有 `Database` 结构和全部调用方，只抽取：

```rust
pub(crate) const CURRENT_DB_VERSION: i64 = 1;
pub(crate) fn initialize_schema_on(conn: &Connection) -> SqliteResult<()>;
```

`Database::new` 仍负责打开真实数据库、启用 WAL 和外键，再调用 `initialize_schema_on`。staging 数据库调用同一个初始化函数，从而复用已有建表和迁移代码，不复制第二套 schema 逻辑。

### 4.2 备份读取与验证

在 `src-tauri/src/lib.rs` 中建立可测试 helper：

- `bind_backup_source`：先打开文件句柄并记录操作系统文件身份，再用只读、no-mutex、nofollow flags 打开同一规范路径。
- 只读连接通过显式读取事务固定 SQLite 快照；复制前同时核对 SQLite 自身打开的文件句柄身份、绑定文件身份和当前路径身份。
- sidecar 检查不使用吞错的 `exists()`；预检和固定快照后的最终检查都对 `-wal`、`-shm`、`-journal` 执行错误感知查询。
- `validate_backup_source`：检查 SQLite 完整性、必要核心表和版本上限。
- `validate_current_schema`：检查完整性、外键以及九张应用表的当前必需列。
- `table_exists`：返回 `Result<bool, String>`，不再把 SQLite 错误伪装成“表不存在”。

`inspect_backup_file` 从已固定的同一个只读连接复制到应用规范 `.restore` 目录中的 `restore-preview-<identity>.sqlite`。返回值分开包含用于显示的 `source_path` 和内部 `restore_preview_path`；版本、大小和表统计都从预览读取。预览路径与操作系统文件身份登记在当前进程的任务注册表中，恢复/显式丢弃必须同时匹配规范目录、精确任务文件名、登记路径和文件身份，不能只凭一个相似文件名获得删除权限。

### 4.3 快照复制

建立唯一的复制原语：

```rust
fn copy_database_snapshot(
    source: &Connection,
    destination: &mut Connection,
) -> Result<(), String>;
```

它使用 `rusqlite::backup::Backup`，一次复制全部剩余页面。只有 `StepResult::Done` 算成功；`Busy`、`Locked`、`More` 和 SQLite 错误都转成明确失败。helper 返回前销毁 backup 句柄，使未完成目标事务回滚。

此原语同时用于：

- 已绑定用户备份 → 一次性恢复预览；
- 一次性恢复预览 → staging；
- 当前 live 数据库 → 恢复前安全快照；
- staging → 当前 live 数据库；
- 极端的恢复后校验失败时，安全快照 → 当前 live 数据库。

### 4.4 恢复编排

Tauri 命令保持现有 IPC 名 `restore_database` 和字符串返回值。复杂流程下沉到可测试的 `restore_database_inner`。

## 5. 数据流

检查与恢复必须严格按以下顺序执行：

1. 规范化用户所选路径，先保护该身份不受陈旧文件清理影响。
2. 打开并记录源文件身份；拒绝 WAL 头以及现存 `-wal`、`-shm`、`-journal`。
3. SQLite 只读打开同一路径并固定读取快照；验证完整性、核心表和版本。
4. 复制前复核 SQLite 打开句柄、绑定句柄和当前路径是同一身份，并再次错误感知检查三个 sidecar。
5. 从这个已经打开且固定快照的连接复制到任务拥有的不可变预览；关闭写连接后从预览读取确认元数据并登记其路径与文件身份。
6. 用户确认时，验证内部路径属于应用规范 `.restore` 目录、文件名精确匹配预览身份，并且当前文件身份仍与任务登记一致。
7. 从预览创建冲突安全的 staging，在 staging 上运行现有 schema 初始化/迁移并验证完整性、外键和当前必需列。
8. 比较 staging 与 live 的 page size；不同则在改动 live 前明确拒绝。
9. 获取 `state.conn` 的唯一互斥锁，并持有到恢复、验证或回滚全部完成。
10. 用高精度时间、进程 ID 和唯一后缀创建安全快照路径；live 复制到安全快照后重新只读验证该快照。
11. staging 复制到当前 live 连接。
12. 在同一个 live 连接上验证完整性、外键、当前 schema，以及 `foreign_keys = 1`。
13. 若第 12 步失败，立即把已验证的安全快照复制回 live，再验证旧库；错误同时报告原始失败和安全快照路径。
14. 释放数据库锁，删除 staging 和一次性预览及其 sidecar；安全快照永久保留。
15. 返回成功消息和安全快照路径，前端刷新数据库信息。

## 6. 失败语义

- 第 11 步前失败：live 数据库完全未改动。
- Online Backup 未到 `Done`：SQLite 回滚目标事务，live 保持原状态。
- live 复制成功但后置验证失败：自动使用安全快照回退。
- 自动回退也失败：返回包含两个错误和安全快照路径的高优先级错误；不得删除安全快照。
- 取消、重新选择以及每次恢复尝试结束都显式清理任务登记的一次性预览；无论恢复结果如何，原始用户所选文件都不删除、不重命名、不改写。
- staging 的正常失败路径都应清理；强制终止留下的精确任务预览/staging 文件及孤立 sidecar 仅在应用规范 `.restore` 目录内、超过安全期限后清理。近期文件和无关名称不触碰。
- 安全快照创建或验证失败时禁止继续恢复。
- 备份 version 高于 `CURRENT_DB_VERSION`、缺必要列、完整性失败、外键失败或 page size 不兼容时禁止触碰 live。

Windows 使用 SQLite Win32 VFS 原生句柄和 `GetFileInformationByHandle`，Unix 使用 SQLite `HAS_MOVED` 文件控制加设备/inode；两者都把 SQLite 已打开连接绑定到同一源身份，而不是在最终 sidecar 检查后重新按路径打开。

## 7. 前端行为

保留现有“选择 → 检查 → 显式确认”流程，只调整结果语义：

- 确认文案明确：所有本地数据会被替换，备份内的进行中或逾期会话也会恢复。
- 确认页只显示原始所选路径；文案说明统计来自一次性预览，确认不会重新读取原文件。
- 取消和重新选择调用显式预览丢弃命令；恢复尝试由后端消费并清理预览。
- 删除“恢复后请重启”的描述，改为“恢复成功后立即生效”。
- 成功后关闭确认框、显示安全快照路径，并调用 `refreshInfo()`。
- 失败继续显示在恢复区域；不能显示成功或刷新成误导状态。
- 恢复成功但统计刷新失败时，数据库信息区域仍显示可见的重试操作。
- 不进行整个 WebView reload。设置页按挂载读取，GlobalFocusButton 会继续轮询，数据管理页主动刷新统计。

## 8. 自动化测试

Rust 测试使用 `std::env::temp_dir()` 下的唯一子目录，不增加 `tempfile`。

最低验收覆盖：

1. 检查有效备份前后原文件字节相同，且不生成 `-wal`、`-shm` 或 journal；确认恢复使用任务预览。
2. 拒绝非 SQLite、截断文件、缺核心表、缺必需列和更高版本。
3. 拒绝把 live 数据库自身作为恢复源。
4. 通过现有 managed connection 立即读到恢复后的 sentinel 数据，无需重新打开连接。
5. 安全快照有效并保留恢复前 sentinel 数据。
6. 旧 schema 在 staging 上复用现有迁移，旧数据保留且当前列齐全。
7. 备份源 WAL 中已提交的内容能进入恢复结果。
8. 强制 `Busy`、`Locked` 或 page-size 不兼容时，live sentinel 保持可查询。
9. staging 后置验证失败时，live 未改动。
10. 连续快速恢复产生不同的安全快照文件。
11. 全九表备份、修改、恢复往返保留 Unicode、NULL、关系和设置。
12. 恢复后 live 连接保持 WAL 与外键 pragma。
13. 检查后替换原路径仍恢复被检查的原始字节；替换/移动已绑定源身份或固定快照后新增 sidecar 会被拒绝。
14. 取消、失败恢复和成功恢复清理一次性预览；相似名称、外部路径和未登记文件不能被丢弃命令删除。
15. 主 staging→live 复制在安全快照之后失败时，安全快照保留且可独立读取恢复前数据。
16. 陈旧清理覆盖主文件缺失的 `staging-*.sqlite-wal`、`-shm`、`-journal`，同时保留近期和无关文件。

实现完成后运行：

```text
npm.cmd run test:unit
npm.cmd run check
npm.cmd run build
cargo test --locked
cargo check --locked
git diff --check
```

## 9. 手工验收

Windows 桌面端至少验证：

- 在应用保持打开时从数据集 B 恢复到备份 A，数据库统计和页面数据立即变为 A。
- 选择并检查 A 后，用有效备份 C 替换原路径；确认后仍恢复一次性预览中的 A，C 保持不变。
- 取消或重新选择后 `.restore` 中对应预览消失，原始 A 的字节保持不变。
- 安全快照包含恢复前的 B。
- 关闭窗口到托盘再重新打开，仍然是 A。
- 连续恢复两次都成功且生成不同安全快照。
- 损坏文件、无关 SQLite、更高版本、live 数据库自身均在 live 改动前被拒绝。
- 第二实例或外部写入者持锁时，恢复要么等待后完成，要么清晰失败；不能部分覆盖。
- 备份内的进行中或逾期 CTDP 会话会由现有绝对时间逻辑收敛到正确状态。

无法在自动化环境可靠覆盖的桌面行为必须在交付报告中明确标记，不能冒充已验证。

## 10. 文档更新

同步最小必要文档：

- `README.md`：恢复在当前进程立即生效；手工复制数据库前必须从托盘真正退出。
- `docs/PRODUCT_SPEC.md`：补充检查、安全快照、立即生效语义。
- `docs/QA_CHECKLIST.md`：加入 Windows 在线恢复往返与失败不改 live 的检查项。

不在本批修改 changelog；发布时再记录用户可见变化。
