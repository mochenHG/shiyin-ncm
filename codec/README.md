# MP3 encoder

The Go application decrypts NCM and decodes FLAC itself. Only MP3 encoding uses the separate, dynamically loaded LAME library.

- Library: LAME 3.100, Windows x64.
- Distribution: https://www.rarewares.org/mp3-lame-libraries.php
- Original archive: https://www.rarewares.org/files/mp3/libmp3lame-3.100x64.zip
- DLL SHA-256: `71dba147b6c16d8d0f012b8e657d52e12cb8796a659e1151200d0a6c8b04bce3`
- Upstream source: https://sourceforge.net/projects/lame/files/lame/3.100/ and https://github.com/lameproject/lame
- License: GNU Library General Public License v2 or later; see [COPYING](COPYING).

The original DLL is embedded for offline use and extracted into the current user's local application cache. Users may replace it with a compatible x64 `libmp3lame.dll` placed beside the EXE; that DLL takes precedence over the embedded copy. No FFmpeg executable is included.
