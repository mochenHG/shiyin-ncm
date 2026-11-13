//go:build windows

package ncm

import (
	"context"
	"fmt"
	"io"
	"os"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"github.com/mewkiz/flac"
	"github.com/mochenHG/shiyin-ncm/codec"
	"golang.org/x/sys/windows"
)

type lameAPI struct {
	handle windows.Handle
	funcs  map[string]uintptr
}

var loadLAME = sync.OnceValues(func() (*lameAPI, error) {
	path, err := codec.Path()
	if err != nil {
		return nil, err
	}
	handle, err := windows.LoadLibraryEx(path, 0, windows.LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|windows.LOAD_LIBRARY_SEARCH_SYSTEM32)
	if err != nil {
		return nil, fmt.Errorf("加载 MP3 编码器失败：%w", err)
	}
	api := &lameAPI{handle: handle, funcs: map[string]uintptr{}}
	for _, name := range []string{"lame_init", "lame_close", "lame_set_num_channels", "lame_set_in_samplerate", "lame_set_out_samplerate", "lame_set_brate", "lame_set_quality", "lame_set_write_id3tag_automatic", "lame_init_params", "lame_encode_buffer_int", "lame_encode_buffer_interleaved_int", "lame_encode_flush", "lame_get_lametag_frame"} {
		ptr, err := windows.GetProcAddress(handle, name)
		if err != nil {
			windows.FreeLibrary(handle)
			return nil, err
		}
		api.funcs[name] = ptr
	}
	return api, nil
})

func (a *lameAPI) call(name string, args ...uintptr) uintptr {
	result, _, _ := syscall.SyscallN(a.funcs[name], args...)
	return result
}
func ptr[T any](values []T) uintptr { return uintptr(unsafe.Pointer(unsafe.SliceData(values))) }

func encodeFLAC(ctx context.Context, reader io.Reader, output *os.File, tagOffset int64) error {
	stream, err := flac.New(reader)
	if err != nil {
		return fmt.Errorf("FLAC 解码失败：%w", err)
	}
	channels := int(stream.Info.NChannels)
	bits := uint(stream.Info.BitsPerSample)
	if channels < 1 || channels > 2 {
		return fmt.Errorf("暂不支持 %d 声道 FLAC", channels)
	}
	if bits < 4 || bits > 32 {
		return fmt.Errorf("不支持的 FLAC 位深：%d", bits)
	}
	api, err := loadLAME()
	if err != nil {
		return err
	}
	encoder := api.call("lame_init")
	if encoder == 0 {
		return fmt.Errorf("无法初始化 MP3 编码器")
	}
	defer api.call("lame_close", encoder)
	outputRate := int(stream.Info.SampleRate)
	if outputRate > 48000 {
		outputRate = 48000
	}
	if outputRate != 32000 && outputRate != 44100 && outputRate != 48000 {
		outputRate = 44100
	}
	for _, setting := range []struct {
		name  string
		value int
	}{{"lame_set_num_channels", channels}, {"lame_set_in_samplerate", int(stream.Info.SampleRate)}, {"lame_set_out_samplerate", outputRate}, {"lame_set_brate", 320}, {"lame_set_quality", 2}} {
		if int32(api.call(setting.name, encoder, uintptr(setting.value))) < 0 {
			return fmt.Errorf("MP3 编码参数设置失败")
		}
	}
	api.call("lame_set_write_id3tag_automatic", encoder, 0)
	if int32(api.call("lame_init_params", encoder)) < 0 {
		return fmt.Errorf("MP3 编码器不支持当前音频参数")
	}
	encoded := make([]byte, 100000)
	pcm := make([]int32, 0, 131070)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		frame, err := stream.ParseNext()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("FLAC 音频损坏：%w", err)
		}
		n := len(frame.Subframes[0].Samples)
		pcm = pcm[:0]
		for sample := 0; sample < n; sample++ {
			for channel := 0; channel < channels; channel++ {
				pcm = append(pcm, frame.Subframes[channel].Samples[sample]<<(32-bits))
			}
		}
		var size uintptr
		if channels == 1 {
			size = api.call("lame_encode_buffer_int", encoder, ptr(pcm), ptr(pcm), uintptr(n), ptr(encoded), uintptr(len(encoded)))
		} else {
			size = api.call("lame_encode_buffer_interleaved_int", encoder, ptr(pcm), uintptr(n), ptr(encoded), uintptr(len(encoded)))
		}
		runtime.KeepAlive(pcm)
		runtime.KeepAlive(encoded)
		if int32(size) < 0 || size > uintptr(len(encoded)) {
			return fmt.Errorf("MP3 编码失败：%d", int32(size))
		}
		if _, err := output.Write(encoded[:int(size)]); err != nil {
			return err
		}
	}
	size := api.call("lame_encode_flush", encoder, ptr(encoded), uintptr(len(encoded)))
	runtime.KeepAlive(encoded)
	if int32(size) < 0 || size > uintptr(len(encoded)) {
		return fmt.Errorf("MP3 收尾编码失败")
	}
	if _, err := output.Write(encoded[:int(size)]); err != nil {
		return err
	}
	size = api.call("lame_get_lametag_frame", encoder, ptr(encoded), uintptr(len(encoded)))
	runtime.KeepAlive(encoded)
	if size > uintptr(len(encoded)) {
		return fmt.Errorf("MP3 长度信息写入失败")
	}
	if size > 0 {
		_, err = output.WriteAt(encoded[:int(size)], tagOffset)
	}
	return err
}
