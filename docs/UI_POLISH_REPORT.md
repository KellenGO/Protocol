# Protocol UI Polish Report

## 1. 改动页面

- 协议复盘：重做顶部说明、复盘模式切换、时间范围切换和主链 review card；空状态改为卡片化展示；失败模式与判例复盘统一为控制台式摘要卡。
- 数据管理：重组数据库信息、备份、恢复、导出、归档说明、重置历史与链进度区域；数据库路径改为可横向滚动的 code 容器；表数量改为 chip/stat row。
- 侧边栏：保留原有导航结构，统一图标占位宽度、选中态、hover 态和低调版本号；文案改为“协议时间线”“协议复盘”。

## 2. 全局样式

- 新增统一页面最大宽度、页面标题块和说明文字间距。
- 统一按钮系统：primary / secondary / danger / ghost，并保留旧的 danger outline 兼容类。
- 统一表单基础高度、badge 状态色、卡片边框、路径 code 容器、notice、chip 和控制行样式。
- 修复原 CSS 末尾数据管理与复盘样式块中断裂的规则，确保复盘和数据管理样式稳定生效。

## 3. 业务逻辑

未修改业务逻辑。

未修改 Rust commands、数据库 schema、业务状态机、路由结构或数据调用。

## 4. 构建结果

- `npm.cmd run build`：通过。
- `cargo check`：通过。命令输出包含 `could not canonicalize path C:\Users\Kellen` 警告，但检查完成并成功。

## 5. 后续仍需打磨

- History 页面仍可进一步卡片化，当前主要沿用原列表结构。
- Dashboard、主链详情、RSIP 的卡片系统可继续向本轮全局样式收敛。
- 当前环境中 Vite dev server 未能通过后台进程常驻，尚未完成 in-app Browser 视觉截图复核。
