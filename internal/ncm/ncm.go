package ncm

import (
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf16"
)

type Result struct {
	Path  string `json:"path"`
	Title string `json:"title"`
	Size  int64  `json:"size"`
}
type metadata struct {
	Name   string          `json:"musicName"`
	Album  string          `json:"album"`
	Artist json.RawMessage `json:"artist"`
}
type header struct {
	meta    metadata
	cover   []byte
	mask    [256]byte
	payload int64
}

func decryptAES(data []byte, keyHex string) ([]byte, error) {
	key, _ := hex.DecodeString(keyHex)
	block, err := aes.NewCipher(key)
	if err != nil || len(data) == 0 || len(data)%16 != 0 {
		return nil, errors.New("NCM 加密数据损坏")
	}
	result := make([]byte, len(data))
	for i := 0; i < len(data); i += 16 {
		block.Decrypt(result[i:i+16], data[i:i+16])
	}
	padding := int(result[len(result)-1])
	if padding < 1 || padding > 16 || padding > len(result) {
		return nil, errors.New("NCM 密钥损坏")
	}
	for _, b := range result[len(result)-padding:] {
		if int(b) != padding {
			return nil, errors.New("NCM 密钥损坏")
		}
	}
	return result[:len(result)-padding], nil
}

func readHeader(file *os.File) (*header, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	var offset int64
	read := func(n int64) ([]byte, error) {
		if n < 0 || n > 32<<20 || offset+n > info.Size() {
			return nil, errors.New("NCM 文件不完整或已损坏")
		}
		b := make([]byte, int(n))
		_, err := io.ReadFull(file, b)
		offset += n
		return b, err
	}
	uint32LE := func() (int64, error) {
		b, e := read(4)
		if e != nil {
			return 0, e
		}
		return int64(binary.LittleEndian.Uint32(b)), nil
	}
	magic, err := read(10)
	if err != nil {
		return nil, err
	}
	if string(magic[:8]) != "CTENFDAM" {
		return nil, errors.New("不是有效的 NCM 文件")
	}
	keyLen, err := uint32LE()
	if err != nil {
		return nil, err
	}
	if keyLen == 0 || keyLen > 1<<20 || keyLen%16 != 0 {
		return nil, errors.New("NCM 密钥数据损坏")
	}
	keyBytes, err := read(keyLen)
	if err != nil {
		return nil, err
	}
	for i := range keyBytes {
		keyBytes[i] ^= 0x64
	}
	key, err := decryptAES(keyBytes, "687a4852416d736f356b496e62617857")
	if err != nil || len(key) <= 17 {
		return nil, errors.New("无法解密 NCM 密钥")
	}
	key = key[17:]
	var box [256]byte
	for i := range box {
		box[i] = byte(i)
	}
	j := 0
	for i := range box {
		j = (j + int(box[i]) + int(key[i%len(key)])) & 255
		box[i], box[j] = box[j], box[i]
	}
	h := &header{}
	for i := range h.mask {
		a := (i + 1) & 255
		h.mask[i] = box[(int(box[a])+int(box[(int(box[a])+a)&255]))&255]
	}
	metaLen, err := uint32LE()
	if err != nil {
		return nil, err
	}
	if metaLen > 16<<20 {
		return nil, errors.New("NCM 信息区异常")
	}
	metaBytes, err := read(metaLen)
	if err != nil {
		return nil, err
	}
	if metaLen > 22 {
		for i := range metaBytes {
			metaBytes[i] ^= 0x63
		}
		if encoded, err := base64.StdEncoding.DecodeString(string(metaBytes[22:])); err == nil {
			if plain, err := decryptAES(encoded, "2331346c6a6b5f215c5d2630553c2728"); err == nil {
				if index := bytes.IndexByte(plain, ':'); index >= 0 {
					_ = json.Unmarshal(plain[index+1:], &h.meta)
				}
			}
		}
	}
	if _, err := read(5); err != nil {
		return nil, err
	}
	frameLen, err := uint32LE()
	if err != nil {
		return nil, err
	}
	coverLen, err := uint32LE()
	if err != nil {
		return nil, err
	}
	if coverLen > frameLen || offset+frameLen >= info.Size() {
		return nil, errors.New("NCM 封面损坏或缺少音频")
	}
	h.cover, err = read(coverLen)
	if err != nil {
		return nil, err
	}
	if _, err := file.Seek(frameLen-coverLen, io.SeekCurrent); err != nil {
		return nil, err
	}
	offset += frameLen - coverLen
	h.payload = info.Size() - offset
	return h, nil
}

type decryptReader struct {
	file          io.Reader
	ctx           context.Context
	mask          [256]byte
	offset, total int64
	progress      func(int)
}

func (r *decryptReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.file.Read(p)
	for i := 0; i < n; i++ {
		p[i] ^= r.mask[(r.offset+int64(i))&255]
	}
	r.offset += int64(n)
	if r.progress != nil && n > 0 {
		r.progress(int(r.offset * 95 / r.total))
	}
	return n, err
}

var illegal = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)
var reserved = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`)

func safeName(value string) string {
	value = strings.TrimRight(strings.TrimSpace(illegal.ReplaceAllString(value, "_")), ". ")
	if reserved.MatchString(value) {
		value = "_" + value
	}
	runes := []rune(value)
	if len(runes) > 130 {
		value = string(runes[:130])
	}
	value = strings.TrimRight(value, ". ")
	if value == "" {
		return "未命名歌曲"
	}
	return value
}
func artists(raw json.RawMessage) string {
	var values []any
	if json.Unmarshal(raw, &values) != nil {
		return ""
	}
	var names []string
	for _, value := range values {
		var name string
		switch item := value.(type) {
		case []any:
			if len(item) > 0 {
				name, _ = item[0].(string)
			}
		case map[string]any:
			name, _ = item["name"].(string)
		}
		if name != "" {
			names = append(names, name)
		}
	}
	return strings.Join(names, " / ")
}
func id3Tag(title, artist, album string, cover []byte) []byte {
	var payload bytes.Buffer
	frame := func(name string, data []byte) {
		payload.WriteString(name)
		_ = binary.Write(&payload, binary.BigEndian, uint32(len(data)))
		payload.Write([]byte{0, 0})
		payload.Write(data)
	}
	for _, field := range [][2]string{{"TIT2", title}, {"TPE1", artist}, {"TALB", album}} {
		if field[1] == "" {
			continue
		}
		var text bytes.Buffer
		text.Write([]byte{1, 0xff, 0xfe})
		for _, ch := range utf16.Encode([]rune(field[1])) {
			_ = binary.Write(&text, binary.LittleEndian, ch)
		}
		frame(field[0], text.Bytes())
	}
	mime := ""
	if bytes.HasPrefix(cover, []byte{255, 216, 255}) {
		mime = "image/jpeg"
	}
	if bytes.HasPrefix(cover, []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		mime = "image/png"
	}
	if mime != "" {
		image := append([]byte{0}, []byte(mime)...)
		image = append(image, 0, 3, 0)
		image = append(image, cover...)
		frame("APIC", image)
	}
	n := payload.Len()
	tag := []byte{'I', 'D', '3', 3, 0, 0, byte(n>>21) & 127, byte(n>>14) & 127, byte(n>>7) & 127, byte(n) & 127}
	return append(tag, payload.Bytes()...)
}

func Convert(ctx context.Context, source, outputDir string, progress func(int)) (*Result, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	input, err := os.Open(source)
	if err != nil {
		return nil, err
	}
	defer input.Close()
	h, err := readHeader(input)
	if err != nil {
		return nil, err
	}
	reader := bufio.NewReaderSize(&decryptReader{file: input, ctx: ctx, mask: h.mask, total: h.payload, progress: progress}, 64<<10)
	magic, err := reader.Peek(4)
	if err != nil {
		return nil, errors.New("音频数据不完整")
	}
	isFLAC := string(magic) == "fLaC"
	if !isFLAC && string(magic[:3]) != "ID3" && !(magic[0] == 255 && magic[1]&0xe0 == 0xe0) {
		return nil, errors.New("无法识别音频，仅支持 MP3 / FLAC")
	}
	title := h.meta.Name
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
	}
	artist := artists(h.meta.Artist)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, err
	}
	temp, err := os.CreateTemp(outputDir, ".shiyin-*.tmp")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	tag := id3Tag(title, artist, h.meta.Album, h.cover)
	if _, err = temp.Write(tag); err != nil {
		return nil, err
	}
	if isFLAC {
		err = encodeFLAC(ctx, reader, temp, int64(len(tag)))
	} else {
		if old, e := reader.Peek(10); e == nil && string(old[:3]) == "ID3" {
			size := int64(old[6]&127)<<21 | int64(old[7]&127)<<14 | int64(old[8]&127)<<7 | int64(old[9]&127)
			if size+10 > h.payload {
				return nil, errors.New("MP3 标签数据损坏")
			}
			skip := size + 10
			if old[3] == 4 && old[5]&0x10 != 0 {
				skip += 10
			}
			if _, e := io.CopyN(io.Discard, reader, skip); e != nil {
				return nil, e
			}
		}
		_, err = io.Copy(temp, reader)
	}
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = temp.Close(); err != nil {
		return nil, err
	}
	base := title
	if artist != "" {
		base = artist + " - " + title
	}
	base = safeName(base)
	var destination string
	for index := 0; ; index++ {
		suffix := ""
		if index > 0 {
			suffix = fmt.Sprintf(" (%d)", index)
		}
		destination = filepath.Join(outputDir, base+suffix+".mp3")
		output, e := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if os.IsExist(e) {
			continue
		}
		if e != nil {
			return nil, e
		}
		saved, e := os.Open(temp.Name())
		if e != nil {
			output.Close()
			os.Remove(destination)
			return nil, e
		}
		_, copyErr := io.Copy(output, saved)
		saved.Close()
		closeErr := output.Close()
		if copyErr != nil || closeErr != nil {
			os.Remove(destination)
			return nil, errors.Join(copyErr, closeErr)
		}
		break
	}
	info, err := os.Stat(destination)
	if err != nil {
		return nil, err
	}
	if progress != nil {
		progress(100)
	}
	return &Result{Path: destination, Title: title, Size: info.Size()}, nil
}
