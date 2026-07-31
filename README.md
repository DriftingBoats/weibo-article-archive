# 微存

微存是一个使用浏览器扩展读取微博、完全在本地保存内容的开源网站。

网站没有服务器、账号系统或云端数据库。文章、章节和可选的手动 Cookie 都保存在当前浏览器；抓取扩展只负责绕过网页无法跨域读取微博的限制，解析、搜索、阅读和导出仍由前端完成。

> 微存不是微博官方产品。请只保存你有权访问和使用的内容，并遵守来源网站的服务条款与适用法律。

## 功能

- 纯静态前端，可部署到 GitHub Pages
- Chromium Manifest V3 抓取扩展
- IndexedDB 本地保存文章、章节和访问设置
- 识别常见微博长文链接
- 自动跟随“下一篇”收录连载
- 使用 Tesseract.js 在浏览器本地识别图片中的中英文
- 保留图片地址、原文位置、OCR 状态与识别文字
- 重复保存同一链接时增量检查
- 每完成一篇立即写入本机，降低意外中断损失
- 本地搜索、阅读、编辑和可撤销删除
- 单份归档导出 TXT、Markdown、JSON
- 全部归档备份与恢复；备份默认不包含 Cookie
- 响应式界面、键盘焦点与减少动态效果支持

## 快速开始

### 1. 运行网站

需要 Node.js 20.19 或更高版本。

```bash
git clone https://github.com/DriftingBoats/weibo-article-archive.git
cd weibo-article-archive
npm install
npm run dev
```

打开 <http://localhost:4173>。

### 2. 安装扩展

先下载扩展包：

<https://github.com/DriftingBoats/weibo-article-archive/releases/latest/download/weicun-extension.zip>

1. 打开 Chromium、Chrome 或 Edge 的扩展管理页。
2. 开启“开发者模式”。
3. 解压 `weicun-extension.zip`。
4. 选择“加载已解压的扩展程序”，并选择刚解压的目录。
5. 刷新微存网页，确认首屏显示绿色的“抓取扩展已连接”。

扩展默认只会注入这些页面：

- `http://localhost/*`
- `http://127.0.0.1/*`
- `https://driftingboats.github.io/weibo-article-archive/*`

自定义部署域名需要同步添加到 [extension/manifest.json](extension/manifest.json) 的 `content_scripts.matches`，并添加到 [extension/background.js](extension/background.js) 的 `senderIsAllowed` 校验中。

## 工作方式

```text
微存网页
  ├─ 解析、阅读、搜索、导出、图片 OCR
  ├─ IndexedDB：文章 / 章节 / 可选 Cookie
  └─ 固定消息桥
       ↓ 只允许文章 ID + 接口编号
浏览器扩展
  ├─ 校验调用页面
  ├─ 校验文章 ID
  ├─ 请求允许范围内的微博接口
  └─ 只读取微博图片域名
       ↓ 原始响应 / 临时图片数据
微存网页解析并写回 IndexedDB
```

网页不能直接读取 `weibo.com` 的跨域响应，也不能自行设置微博 Cookie，因此需要扩展。扩展不接受任意 URL，只接受固定编号的微博接口请求。

图片 OCR 默认开启。扩展把微博图片临时交给当前微存页面，Tesseract.js 在浏览器内完成识别；图片不会发送到微存服务器，也不会作为二进制写入归档。IndexedDB 只保存原图地址、图片在正文中的位置和识别文字。首次识别会下载中文与英文识别模型，之后浏览器会复用缓存。阅读页可以对失败图片重试，也可以为旧归档重新读取图片并补做 OCR。

## Cookie

公开文章通常无需填写凭据。需要登录查看的内容会优先使用扩展检测到的当前微博登录状态。

- 扩展会自动检测当前浏览器已有的微博登录 Cookie，再向微博登录状态接口验证是否仍然有效；请求期间通过会话级浏览器规则附加 Cookie，规则在单次请求后立即删除。微博拒绝扩展来源请求时，扩展会复用已打开的微博标签页在第一方页面环境中重试；没有可复用页面时会短暂打开后台标签页并在请求后关闭。
- 手动填写 Cookie 仅作为未在当前浏览器登录微博时的备用方式。
- 手动 Cookie 写入当前网站源的 IndexedDB。
- 微存没有后端，因此不会上传到微存服务器。
- Cookie 会由扩展导入当前浏览器的微博 Cookie 存储，以便扩展请求携带登录状态。
- 单份导出和“备份全部”默认都不包含本地凭据。
- 清除浏览器站点数据会同时删除归档和本地访问设置。

如果电脑由多人共用，请使用独立的浏览器个人资料，并在不再需要时清除本地访问设置。

## 本地数据与备份

文章和设置使用 IndexedDB 数据库 `weicun-archive`。

建议定期在“我的归档”中选择“备份全部”。备份是一个 JSON 文件，可以在另一台电脑或另一个浏览器中通过“恢复备份”合并导入。凭据不会进入备份，需要在新浏览器中单独设置。

## 生产构建

```bash
npm run build
npm run preview
```

构建结果位于 `dist/`。默认生产路径是 `/weibo-article-archive/`，适用于项目的 GitHub Pages 地址。使用自定义域名或部署到站点根目录时：

```bash
VITE_BASE_PATH=/ npm run build
```

## GitHub Pages

仓库包含 Pages 自动部署工作流：

1. 在 GitHub 仓库的 Settings → Pages 中选择 GitHub Actions。
2. 推送到 `main`。
3. CI 通过后，网站会发布到：

```text
https://driftingboats.github.io/weibo-article-archive/
```

扩展需要由用户从仓库下载并加载。未在 Chrome Web Store 发布前，网站不能静默安装本地扩展。

## 项目结构

```text
extension/
  manifest.json       # Manifest V3 权限与注入范围
  background.js       # 微博请求、来源和参数校验
  bridge.js           # 网页与扩展消息桥
  popup.*             # 扩展状态页
public/
  styles.css          # 网站视觉系统
src/
  app.js              # 页面与交互
  crawler.js          # 连载和增量抓取
  extension-bridge.js # 前端消息客户端
  parser.js           # HTML / JSON 解析
  ocr.js              # 浏览器本地图片文字识别
  storage.js          # IndexedDB 数据层与备份
  export.js           # 本地文件导出
  url.js              # 微博 URL 校验
test/                 # 自动化测试
```

## 测试

```bash
npm run check
npm test
npm run build
```

自动化测试不访问微博网络。项目还使用真实 Chrome 验证扩展注入、消息桥连接和固定微博接口请求。

## 已知限制

- 微博页面和接口结构变化后，解析适配可能需要更新。
- OCR 速度取决于设备性能和图片数量；超过 10 MB 的单张图片会跳过识别。
- 图片二进制不会写入备份，阅读页展示原图时仍需要能够访问微博图片地址。
- 浏览器隐私设置、账号权限或微博风控可能阻止个别内容读取。
- 扩展当前以 Chromium Manifest V3 为目标，尚未提供 Firefox 版本。
- 使用自定义网站域名需要重新加载修改后的扩展。

## 安全

不要在 issue、日志或截图中公开 Cookie。安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 参与贡献

欢迎提交微博结构兼容、无障碍、浏览器兼容和文档改进。参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
