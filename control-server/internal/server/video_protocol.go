package server

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

type videoPacketHeader struct {
	displayID      int32
	displayWidth   int32
	displayHeight  int32
	orientation    uint8
	orientationFix uint8
	flags          int16
	bitRate        int32
	frameNumber    uint32
	originationUS  int64
	presentationUS int64
	packetSize     int32
}

func parseVideoPacketHeader(data []byte) (videoPacketHeader, error) {
	if len(data) != videoHeaderSize {
		return videoPacketHeader{}, fmt.Errorf("video header has %d bytes, want %d", len(data), videoHeaderSize)
	}
	return videoPacketHeader{
		displayID:      int32(binary.LittleEndian.Uint32(data[0:4])),
		displayWidth:   int32(binary.LittleEndian.Uint32(data[4:8])),
		displayHeight:  int32(binary.LittleEndian.Uint32(data[8:12])),
		orientation:    data[12],
		orientationFix: data[13],
		flags:          int16(binary.LittleEndian.Uint16(data[14:16])),
		bitRate:        int32(binary.LittleEndian.Uint32(data[16:20])),
		frameNumber:    binary.LittleEndian.Uint32(data[20:24]),
		originationUS:  int64(binary.LittleEndian.Uint64(data[24:32])),
		presentationUS: int64(binary.LittleEndian.Uint64(data[32:40])),
		packetSize:     int32(binary.LittleEndian.Uint32(data[40:44])),
	}, nil
}

type avcStreamParser struct {
	lengthSize int
	sps        []byte
	pps        []byte
}

func (p *avcStreamParser) parse(data []byte) ([][]byte, bool, error) {
	if len(data) == 0 {
		return nil, false, nil
	}
	if isAVCDecoderConfigurationRecord(data) {
		nalus, lengthSize, err := parseAVCDecoderConfigurationRecord(data)
		if err != nil {
			return nil, false, err
		}
		p.lengthSize = lengthSize
		changed := p.updateParameterSets(nalus)
		return nalus, changed, nil
	}

	var nalus [][]byte
	if hasAnnexBStartCode(data) {
		nalus = splitAnnexBNALUs(data)
	} else {
		lengthSizes := []int{p.lengthSize, 4, 2, 1, 3}
		for _, lengthSize := range lengthSizes {
			if lengthSize <= 0 || lengthSize > 4 {
				continue
			}
			parsed, ok := splitLengthPrefixedNALUs(data, lengthSize)
			if ok {
				nalus = parsed
				p.lengthSize = lengthSize
				break
			}
		}
		if len(nalus) == 0 && isNALUnit(data) {
			nalus = [][]byte{data}
		}
		if len(nalus) == 0 {
			return nil, false, errors.New("video packet is neither Annex-B nor length-prefixed AVC")
		}
	}
	changed := p.updateParameterSets(nalus)
	return nalus, changed, nil
}

func (p *avcStreamParser) updateParameterSets(nalus [][]byte) bool {
	var nextSPS, nextPPS []byte
	for _, nalu := range nalus {
		if len(nalu) == 0 {
			continue
		}
		switch nalu[0] & 0x1f {
		case 7:
			nextSPS = nalu
		case 8:
			nextPPS = nalu
		}
	}
	changed := false
	if len(nextSPS) != 0 && !bytes.Equal(p.sps, nextSPS) {
		p.sps = append(p.sps[:0], nextSPS...)
		changed = true
	}
	if len(nextPPS) != 0 && !bytes.Equal(p.pps, nextPPS) {
		p.pps = append(p.pps[:0], nextPPS...)
		changed = true
	}
	return changed
}

func isAVCDecoderConfigurationRecord(data []byte) bool {
	return len(data) >= 7 && data[0] == 1 && data[4]&0xfc == 0xfc && data[5]&0xe0 == 0xe0
}

func parseAVCDecoderConfigurationRecord(data []byte) ([][]byte, int, error) {
	if !isAVCDecoderConfigurationRecord(data) {
		return nil, 0, errors.New("invalid AVC decoder configuration record")
	}
	lengthSize := int(data[4]&0x03) + 1
	position := 6
	sets := make([][]byte, 0, int(data[5]&0x1f)+1)
	readSets := func(count int) error {
		for i := 0; i < count; i++ {
			if position+2 > len(data) {
				return errors.New("truncated AVC parameter-set length")
			}
			size := int(binary.BigEndian.Uint16(data[position : position+2]))
			position += 2
			if size == 0 || position+size > len(data) {
				return errors.New("truncated AVC parameter set")
			}
			sets = append(sets, append([]byte(nil), data[position:position+size]...))
			position += size
		}
		return nil
	}
	if err := readSets(int(data[5] & 0x1f)); err != nil {
		return nil, 0, err
	}
	if position >= len(data) {
		return nil, 0, errors.New("AVC configuration has no PPS count")
	}
	ppsCount := int(data[position])
	position++
	if err := readSets(ppsCount); err != nil {
		return nil, 0, err
	}
	return sets, lengthSize, nil
}

func hasAnnexBStartCode(data []byte) bool {
	_, _, ok := findAnnexBStartCode(data, 0)
	return ok
}

func findAnnexBStartCode(data []byte, from int) (int, int, bool) {
	for i := from; i+2 < len(data); i++ {
		if data[i] != 0 || data[i+1] != 0 {
			continue
		}
		if data[i+2] == 1 {
			return i, 3, true
		}
		if i+3 < len(data) && data[i+2] == 0 && data[i+3] == 1 {
			return i, 4, true
		}
	}
	return 0, 0, false
}

func splitAnnexBNALUs(data []byte) [][]byte {
	position, prefixSize, ok := findAnnexBStartCode(data, 0)
	if !ok {
		return nil
	}
	result := make([][]byte, 0, 4)
	for ok {
		start := position + prefixSize
		nextPosition, nextPrefixSize, found := findAnnexBStartCode(data, start)
		end := len(data)
		if found {
			end = nextPosition
		}
		for end > start && data[end-1] == 0 {
			end--
		}
		if end > start {
			result = append(result, data[start:end])
		}
		position, prefixSize, ok = nextPosition, nextPrefixSize, found
	}
	return result
}

func splitLengthPrefixedNALUs(data []byte, lengthSize int) ([][]byte, bool) {
	position := 0
	result := make([][]byte, 0, 4)
	for position < len(data) {
		if position+lengthSize > len(data) {
			return nil, false
		}
		var size uint32
		for _, value := range data[position : position+lengthSize] {
			size = size<<8 | uint32(value)
		}
		position += lengthSize
		if size == 0 || uint64(position)+uint64(size) > uint64(len(data)) {
			return nil, false
		}
		end := position + int(size)
		if !isNALUnit(data[position:end]) {
			return nil, false
		}
		result = append(result, data[position:end])
		position = end
	}
	return result, len(result) != 0
}

func isNALUnit(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	typeID := data[0] & 0x1f
	return data[0]&0x80 == 0 && typeID > 0 && typeID < 24
}

func hasVideoNALU(nalus [][]byte) bool {
	for _, nalu := range nalus {
		if len(nalu) != 0 {
			typeID := nalu[0] & 0x1f
			if typeID >= 1 && typeID <= 5 {
				return true
			}
		}
	}
	return false
}
