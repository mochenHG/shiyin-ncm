# 拾音 NCM

一个简单、好看的 Windows 本地 NCM 转 MP3 工具。

- 拖入文件或导入整个文件夹，支持批量转换和子文件夹。
- 自选输出位置，全程离线，不上传文件、不修改源文件。
- 保留歌曲信息与封面，同名文件自动避让。
- 深浅色模式默认跟随系统，配有轻盈的唱片动画。

**[下载 Windows 免安装版](https://github.com/mochenHG/shiyin-ncm/releases/latest)**，双击 EXE 即可使用。适用于 Windows 10 / 11 64 位。

已有 MP3 音源直接保留音频；FLAC 音源会转为 320 kbps MP3。

## 本地运行与构建

需要 Node.js 22.12 或更新版本。

```powershell
npm ci
node node_modules/electron/install.js
npm start
```

运行 `npm test` 检查转换功能，`npm run build` 生成 EXE。第三方组件信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
