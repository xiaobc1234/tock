# Tock

Tock 是一个免费的桌面浮窗。展开就能同时看到 5 小时和每周的额度重置时间，收起后在屏幕边缘留一个可点击的胶囊按钮。安装包已内置 Codex CLI，用 ChatGPT 账号登录即可。

![Tock 桌面浮窗示例，显示两项重置时间、自动发送和发送记录入口](docs/tock-preview.png)

截图使用示例数据。

## 下载

从 [GitHub Releases](../../releases/latest) 下载适合你的版本。

| 你的电脑 | 下载文件 |
| --- | --- |
| Windows 10 / 11，Intel 或 AMD 64 位 | `Tock-版本-win-x64.exe` |
| Mac，Apple 芯片（M 系列） | `Tock-版本-mac-arm64.zip` |
| Mac，Intel 处理器 | `Tock-版本-mac-x64.zip` |

两个 Mac 版本都需要 macOS 13 Ventura 或更新版本。在 Mac 的「 → 关于本机」查看「芯片」或「处理器」即可确认要下载哪一版。

## 功能特性

- **重置时间一目了然。** 显示 Codex 账号实际提供的 5 小时和每周重置时间，按电脑的本地时区显示。
- **随手收起。** 面板和胶囊按钮都能拖拽吸附到屏幕四边。点击胶囊即可展开，扫光会遵守系统的减少动态效果设置。
- **到点复查，按需发送。** 可选在重置时间过 1 分钟后复查。用户已开启新周期时会跳过发送，中间没有固定轮询。
- **看得到发送记录。** 面板底部可查看最近 50 次尝试，包括时间、手动或自动，以及发送是否确认。
- **控制用量。** 发送前显示所用模型和推理等级。手动和自动共用 15 分钟冷却，滚动 24 小时最多 6 次。

## 使用指南

1. **安装与登录。** Windows 双击 `.exe` 安装。Mac 解压 `.zip`，将 Tock 拖入「应用程序」后打开。已有 Codex 登录会自动复用，首次使用可点击「登录 ChatGPT」，在浏览器完成登录。
2. **查看额度。** 展开面板即可查看重置时间。在 Codex 切换账号后，可以点右上角刷新。下次定时任务也会重新识别账号并重新排程。
3. **选择是否自动发送。** 默认关闭。开启后，Tock 优先使用 GPT‑6 Luna 的低用量档位，额度服务确认有可用订阅额度才会发送。可以随时通过「发送记录」核对结果。
4. **控制浮窗。** 拖标题栏或胶囊按钮换边，点减号收起，点电源图标退出。需要后台计时就保持 Tock 运行，也可以从系统托盘或菜单栏设置登录系统时启动。

Tock 跟踪的是 Codex / ChatGPT Work 的订阅用量窗口。问候会消耗少量订阅额度。额度不足、可能使用付费 credits 或服务端无法确认可用额度时，会暂停发送。首次还没有重置时间时，可用「手动发送」建立窗口，或等下一次正常使用 Codex 后刷新。

目前提供的是预览包。macOS 包未经过 Apple 公证，Windows 安装程序未进行发布者签名，系统可能提示无法验证发布者。

## 构建指南

开发需要 Node.js 22.12 或更新版本。安装依赖、运行测试并启动开发版：

```sh
npm ci
npx install-electron
npm test
npm start
```

在各自的目标平台上执行对应命令，构建产物输出到 `dist/`。打包会按目标架构捆绑锁定版本的 Codex CLI。

| 目标 | 构建命令 |
| --- | --- |
| Windows x64 | `npm run package -- --target=win32-x64` |
| Mac Apple Silicon | `npm run package -- --target=darwin-arm64` |
| Mac Intel | `npm run package -- --target=darwin-x64` |

在独立 GitHub 仓库中也可以打开 **Actions → Build desktop packages → Run workflow**，一次生成三个构建产物。公开发版时，将三个安装包附加到同一条 [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。

### 在 GitHub 上发布

1. 将对应版本的源码提交到仓库的默认分支。
2. 打开 **Releases → Draft a new release**。首次发布也可能显示 **Create a new release**。
3. 在 **Choose a tag** 中创建与 `package.json` 一致的版本标签，例如 `v0.2.3`，将目标设为包含这份源码的分支或提交。
4. 填写版本标题与更新说明，把 Windows x64、Mac Apple Silicon 和 Mac Intel 三个安装包拖入附件区。等待三个文件上传完成，再点 **Publish release**。

发布后，仓库地址后加 `/releases/latest` 即可分享最新版下载页。GitHub 会根据标签自动生成源码压缩包。详细步骤见 [GitHub 发布文档](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## 数据与许可

Tock 通过本机 Codex App Server 查询额度和发送已启用的问候。邮箱用于当前界面显示，发送记录与窗口设置保存在本机。登录凭据由 Codex 管理。Tock 没有自建遥测服务。

本项目采用 [MIT 许可证](LICENSE)。内置 Codex CLI 按 [Apache 2.0](CODEX-LICENSE) 分发。有关本机登录集成的适用范围，见 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。
