# Security Policy

## Supported version

安全更新目前只针对最新的 `main` 分支。

## Reporting a vulnerability

请通过 GitHub Security Advisory 私下报告以下问题，不要创建公开 issue：

- Cookie 从 IndexedDB、导出文件或消息桥意外泄漏
- 非微存页面可以调用扩展
- 扩展可以被诱导请求任意 URL
- 绕过允许的微博域名或文章 ID 校验
- 恶意备份文件导致脚本执行或越权读取

请提供受影响的 commit、最小复现步骤、影响和建议缓解方式。

## Local data model

微存把文章和凭据保存在当前浏览器。它不提供加密保险库能力：任何能访问当前浏览器个人资料和站点数据的软件，都可能读取这些内容。请使用受信任设备和独立浏览器个人资料。

扩展把用户手动提供的 Cookie 导入浏览器 Cookie 存储。删除微存的 IndexedDB 设置不会自动退出微博；如需彻底移除登录状态，还应清除相应微博 Cookie。

备份文件不会包含本地 Cookie，但可能包含归档正文。请把它作为私人文档妥善保存。
