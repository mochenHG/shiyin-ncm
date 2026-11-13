# 拾音 NCM (Shiyin NCM) — third-party notices

This is an independent offline desktop implementation. Functional reference: https://tools.athbe.cn/ncm/ . The website is not embedded, contacted, or required at runtime. Visual direction follows the user's local Cloudy project: rounded surfaces, soft red accents, glass-like surfaces and record artwork. Application code and the cloud/record icon were created for this project; Cloudy's Go code and brand images are not bundled.

NCM's container format was checked against the ncmdump project (https://github.com/taurusxin/ncmdump) and the reference website's WebAssembly decoder. The website files in `reference/` are verification material only and are excluded from the executable. The application has its own streaming decoder.

Bundled components:

- Electron 45.3.1 — MIT, https://github.com/electron/electron . The distribution contains Electron and Chromium license notices.
- FFmpeg 6.1.1 essentials, Gyan.dev build, distributed via ffmpeg-static 5.3.0 — GPL v3. The binary is a separate executable. Its full license and build README are included as resources/ffmpeg-LICENSE.txt and resources/ffmpeg-README.txt. Exact source revision and build configuration are in that README: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 . Binary distribution: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 . Build project: https://www.gyan.dev/ffmpeg/builds/ .

Node.js, Chromium and FFmpeg have additional component notices in their respective distributions. `sharp`, Playwright and electron-builder are development tools and are not required by the installed app.
