# 拾音 NCM — third-party notices

The current application is written in Go and uses the system's Microsoft WebView2 runtime. It does not bundle Electron, Chromium or FFmpeg.

- Wails v2.17.0 — MIT: https://github.com/wailsapp/wails . Its Go WebView2 bindings and other Go dependency notices remain in their upstream modules listed in `go.mod` and `go.sum`.
- mewkiz/flac v1.0.14 — Unlicense (public domain): https://github.com/mewkiz/flac . Used for streaming FLAC decoding.
- LAME 3.100 — GNU Library General Public License v2 or later: see [codec/COPYING](codec/COPYING) and [codec/README.md](codec/README.md) for the exact binary, source links, checksum and instructions for replacing the separate DLL.

The synthetic audio in `internal/ncm/testdata/` contains generated sine waves, not commercial music. The MP3 decoder used only in tests is github.com/hajimehoshi/go-mp3; it is not linked into the released application. The optional Node.js development tools only regenerate test fixtures and are not needed to build or run the Go app.

Functional reference: https://tools.athbe.cn/ncm/ . The website is not embedded, contacted, or required at runtime. The NCM container was checked against https://github.com/taurusxin/ncmdump and the website's decoder during development; its downloaded files are excluded from the repository and executable. The streaming decoder is implemented independently in Go.

Visual direction follows the user's earlier Cloudy project. The app's Go code, cloud/record icon and interface assets were made for this project; Cloudy's application code and brand assets are not bundled.
