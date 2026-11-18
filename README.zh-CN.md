# 元素选择器（Browser Selector）

[English](README.md) | 简体中文

一款 Chrome 扩展（Manifest V3），用一个快捷键加鼠标即可抓取页面元素：复制**最佳 CSS 选择器**、XPath、JS 路径、文本或 HTML，并支持**元素 / 可见区域 / 整页截图**。

## 安装（开发者模式）

1. 打开 `chrome://extensions`，开启右上角的**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择本文件夹（包含 `manifest.json` 的目录）。
3. 将扩展固定到工具栏。如果某个快捷键已被其他扩展占用，可在 `chrome://extensions/shortcuts` 中重新设置。

## 快捷键

全局快捷键（在任意页面均可使用）：

| | |
|---|---|
| <kbd>Alt+C</kbd> | 开启 / 关闭元素选择器 |
| <kbd>Alt+S</kbd> | 截取可见区域 |
| <kbd>Alt+A</kbd> | 截取整个页面 |

选择器开启后：

| | |
|---|---|
| <kbd>单击</kbd> | 复制最佳 CSS 选择器 |
| <kbd>S</kbd> | 截取当前高亮的元素 |
| <kbd>右键</kbd> | 打开包含全部功能的菜单：XPath、JS 路径、文本、HTML、可见区域 / 整页截图、父元素 / 子元素 |
| <kbd>Esc</kbd> | 关闭菜单 / 退出选择器 |

信息面板上还有 **复制 CSS · 截图 · 父元素 ↑ · 更多…** 按钮。点击**父元素 ↑** 后，父元素会保持选中（显示为*已锁定*），即使鼠标移回去也不会改变；下一次复制或截图后自动解除锁定。

所有全局快捷键都可以在 `chrome://extensions/shortcuts` 中修改。

<details>
<summary>选择器内的可选单键快捷键（点击面板中的 <b>?</b> 显示）</summary>

| | |
|---|---|
| <kbd>C</kbd> / <kbd>Ctrl+C</kbd> / <kbd>Enter</kbd> | 复制最佳 CSS 选择器 |
| <kbd>1</kbd>–<kbd>4</kbd> | 复制最佳 / 备选选择器 |
| <kbd>X</kbd> | 复制 XPath |
| <kbd>J</kbd> | 复制 JS 路径（`document.querySelector(...).shadowRoot.querySelector(...)`） |
| <kbd>T</kbd> / <kbd>O</kbd> | 复制文本 / outerHTML |
| <kbd>V</kbd> / <kbd>F</kbd> | 截取可见区域 / 整个页面 |
| <kbd>↑</kbd> <kbd>↓</kbd> | 选择父元素 / 返回子元素 |
| <kbd>←</kbd> <kbd>→</kbd> | 上一个 / 下一个兄弟元素 |
| <kbd>Space</kbd> | 锁定选择，忽略鼠标移动 |
| <kbd>H</kbd> | 显示 / 隐藏此列表 |

</details>

> **从旧版本升级：** Chrome 只在全新安装时应用默认快捷键，并会保留你之前已有的设置。如需使用 Alt+C / Alt+S / Alt+A，请在 `chrome://extensions/shortcuts` 中设置，或移除扩展后重新加载已解压的扩展程序。

截图会以 PNG 格式复制到剪贴板，也可以通过提示框保存到 `下载/browser-selector/`，或在设置中开启自动保存。

## 语言

扩展支持 **English** 和 **简体中文**。可在弹出窗口或设置页的下拉菜单中选择语言。**自动**会跟随浏览器语言，任何中文变体都会回退到简体中文。切换后，弹出窗口、设置页和页面内的选择器会立即生效。

翻译分为两层：

- `src/shared/i18n.js` + `src/shared/locales/<code>.js` 存放所有界面文案。之所以使用自定义实现而不是 `chrome.i18n`，是为了能在设置中切换语言。
- `_locales/<code>/messages.json` 存放扩展名称、描述和快捷键名称。这些由 Chrome 自身读取，始终跟随浏览器语言。

### 添加新语言（以日语为例）

1. 将 `src/shared/locales/en.js` 复制为 `ja.js`，把 `.en =` 改为 `.ja =`，然后翻译各项内容。保留所有 `{0}` 占位符。
2. 在 `src/shared/i18n.js` 的 `BS_LANGUAGES` 中添加 `{ code: 'ja', name: '日本語' }`。
3. 在其他语言文件被加载的所有位置加载该文件：
   - `src/background.js` 中的 `importScripts` 和 `CONTENT_FILES`
   - `popup.html` 和 `options.html` 中的 `<script>` 标签
   - `test/playground.html`
4. 将 `_locales/en/messages.json` 复制到 `_locales/ja/messages.json` 并翻译。
5. 打开 playground 测试页。i18n 检查会标出缺失或多余的键、占位符不一致，以及代码中使用但未定义的键。

## “最佳选择器”是如何选出的

`src/content/selector.js` 会为目标元素及其祖先元素的候选选择器打分，然后通过最优优先搜索，找出**只**匹配目标元素且代价最低的选择器链：

1. 测试属性（`data-testid`、`data-test`、`data-cy`、`data-qa` 等，可配置）
2. 稳定的 `#id`
3. `name`、`for`、`aria-label`、`alt`、`placeholder`、`title`、`href`、`role`、`type`
4. 稳定的 class 名称（Tailwind 工具类和通用名称得分较低）
5. 标签名（语义化标签和自定义元素标签得分较高）
6. 最后才使用 `:nth-of-type()`，再不行则使用完整的锚定路径

看起来是自动生成的值会被跳过：React `useId`（`:r3:`）、CSS Modules 哈希（`Button_root__a1B2c`）、styled-components / emotion（`sc-…`、`css-…`）、UUID、长数字（`ember1234`），以及状态类（`active`、`is-open` 等）。最多提供 3 个不重复的备选选择器。对于位于开放 Shadow Root 中的元素，会生成其所在 Root 内的选择器以及宿主链，JS 路径则会逐层穿透 Shadow Root。

## 项目结构

```
manifest.json
src/background.js          Service Worker：命令、脚本注入、限速截图、拼接、下载、历史记录
src/content/selector.js    选择器 / XPath 引擎（无依赖）
src/content/picker.js      遮罩层、信息面板、键盘处理、截图驱动
src/shared/defaults.js     所有上下文共用的默认设置
src/shared/i18n.js         翻译工具（BS_t、BS_applyI18n、语言检测）
src/shared/locales/        界面文案：en.js、zh_CN.js
_locales/                  由 Chrome 管理的文案：扩展名称、描述、快捷键名称
src/popup/                 工具栏弹出窗口（操作 + 最近复制记录）
src/options/               设置页
icons/                     生成的 PNG 图标
test/playground.html       测试页面 + 引擎测试（使用 chrome.* 桩对象运行真实的内容脚本）
test/serve.ps1             用于 playground 的简易静态服务器
```

## 权限

`activeTab` + `scripting` 只会把选择器注入到你按下快捷键或点击弹出窗口的那个标签页，因此不需要 `<all_urls>` 主机权限。`downloads` 用于保存截图，`storage` 用于保存设置和历史记录，`clipboardWrite` 用于复制内容。

## 测试

```
powershell -ExecutionPolicy Bypass -File test/serve.ps1
```

然后打开 http://localhost:8765/test/playground.html。i18n 区域会检查翻译是否完整；引擎结果区域会检查每个测试元素是否都能得到唯一的 CSS 选择器和 XPath、预期的最佳结果是否正确，并确认自动生成的标记已被跳过。如需在该页面试用选择器界面，可在开发者工具控制台中运行 `__BS_PICKER__.start()`。

## 已知限制

- Chrome 内部页面（`chrome://`、应用商店、PDF 查看器）无法注入脚本。在这些页面上，截图快捷键会保存可见区域的截图。
- iframe：选择器只在顶层框架中运行。
- 整页截图通过滚动窗口实现。对于在内部容器中滚动的应用（`height: 100vh; overflow: auto`），只能截取视口内容。
- `captureVisibleTab` 每秒最多调用约 2 次，因此整页截图每屏大约需要 0.6 秒。
