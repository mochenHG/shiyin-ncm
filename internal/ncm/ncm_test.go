package ncm

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"

	mp3 "github.com/hajimehoshi/go-mp3"
)

func skipTag(data []byte) []byte {
	if len(data) >= 10 && string(data[:3]) == "ID3" {
		n := int(data[6]&127)<<21 | int(data[7]&127)<<14 | int(data[8]&127)<<7 | int(data[9]&127)
		return data[n+10:]
	}
	return data
}

// MP3 containers must preserve every original audio frame and embed NCM tags and cover.
func TestMP3PreservesFramesAndSource(t *testing.T) {
	source := "testdata/mp3.ncm"
	before, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	result, err := Convert(context.Background(), source, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("testdata/raw.mp3")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(skipTag(actual), skipTag(raw)) {
		t.Fatal("original MP3 frames changed")
	}
	for _, tag := range []string{"TIT2", "TPE1", "TALB", "APIC"} {
		if !bytes.Contains(actual, []byte(tag)) {
			t.Fatalf("missing %s", tag)
		}
	}
	after, _ := os.ReadFile(source)
	if !bytes.Equal(before, after) {
		t.Fatal("source was modified")
	}
}

// Mono and 24-bit/96kHz stereo FLAC must become playable MP3 with correct duration and amplitude.
func TestFLACEncoding(t *testing.T) {
	for _, name := range []string{"flac.ncm", "stereo24.ncm"} {
		t.Run(name, func(t *testing.T) {
			result, err := Convert(context.Background(), filepath.Join("testdata", name), t.TempDir(), nil)
			if err != nil {
				t.Fatal(err)
			}
			file, err := os.Open(result.Path)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			decoder, err := mp3.NewDecoder(file)
			if err != nil {
				t.Fatal(err)
			}
			pcm, err := io.ReadAll(decoder)
			if err != nil {
				t.Fatal(err)
			}
			seconds := float64(len(pcm)) / float64(decoder.SampleRate()*4)
			if math.Abs(seconds-4) > .16 {
				t.Fatalf("duration %.3f", seconds)
			}
			if name == "stereo24.ncm" && decoder.SampleRate() != 48000 {
				t.Fatalf("sample rate %d", decoder.SampleRate())
			}
			var energy float64
			for i := 0; i+1 < len(pcm); i += 2 {
				s := float64(int16(binary.LittleEndian.Uint16(pcm[i:i+2]))) / 32768
				energy += s * s
			}
			rms := math.Sqrt(energy / float64(len(pcm)/2))
			if rms < .02 || rms > .2 {
				t.Fatalf("wrong PCM scaling: RMS %f", rms)
			}
		})
	}
}

// A repeated conversion must create a second name without changing the first result.
func TestCollisionAndCancellation(t *testing.T) {
	dir := t.TempDir()
	first, err := Convert(context.Background(), "testdata/mp3.ncm", dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(first.Path)
	second, err := Convert(context.Background(), "testdata/mp3.ncm", dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(first.Path)
	if first.Path == second.Path || !bytes.Equal(before, after) {
		t.Fatal("existing output was overwritten")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Convert(ctx, "testdata/flac.ncm", dir, nil); err == nil {
		t.Fatal("cancelled job succeeded")
	}
	files, _ := filepath.Glob(filepath.Join(dir, ".shiyin-*"))
	if len(files) != 0 {
		t.Fatal("temporary files left behind")
	}
}

// Truncated or forged NCM headers must fail without producing an output.
func TestCorruptHeaders(t *testing.T) {
	original, err := os.ReadFile("testdata/mp3.ncm")
	if err != nil {
		t.Fatal(err)
	}
	for _, length := range []int{0, 8, 14, 90, 200} {
		dir := t.TempDir()
		source := filepath.Join(dir, "bad.ncm")
		if err := os.WriteFile(source, original[:length], 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Convert(context.Background(), source, dir, nil); err == nil {
			t.Fatalf("accepted truncated length %d", length)
		}
	}
}
