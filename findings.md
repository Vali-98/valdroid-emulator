# H.264 Stream Investigation — Current Findings

## 1. Stream Format

The video stream begins with a 20-byte header:

```text
61 76 63 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20
```

ASCII:

```text
"avc                 "
```

The payload following this header is an H.264/AVC elementary stream.

The stream can be captured directly as `capture.h264`.

---

## 2. H.264 NAL Structure

The stream uses Annex-B style start codes and contains standard H.264 NAL units.

Observed NAL types:

| Type | Meaning                 | Observed     |
| ---: | ----------------------- | ------------ |
|    1 | Non-IDR slice (P-frame) | Yes          |
|    3 | Slice partition B       | Occasionally |
|    5 | IDR slice (I-frame)     | Yes          |
|    7 | SPS                     | Yes          |
|    8 | PPS                     | Yes          |
|    0 | Unknown/reserved        | Occasionally |

Typical startup sequence:

```text
SPS
PPS
IDR
[unknown NAL]
IDR
P
P
P
...
```

The first IDR is followed by a second IDR with the same `frame_num = 0` but a different `idr_pic_id`, followed by normal P-frames.

---

## 3. SPS

Observed SPS:

```text
67 42 C0 2A 8D 68 0E 80 40 79 6E 42 02 02 02 0F 08 84 6A
```

Decoded properties:

```text
Profile:              Baseline
Profile ID:           66 (0x42)
Constraint flags:     0xC0
Level:                4.2
SPS ID:                0
Chroma format:        4:2:0
Luma bit depth:       8
Chroma bit depth:     8
Max frame number:     65536
POC type:             2
Max reference frames: 1
Frame gaps:           false
```

### Resolution

```text
Macroblocks width:    58
Macroblocks height:   128
Frame MBs only:       true

Cropping:
    Left:   0
    Right:  4
    Top:    0
    Bottom: 2

Resolution:            920 × 2044
```

The coded dimensions are therefore:

```text
58 × 16 = 928
128 × 16 = 2048
```

with SPS cropping producing the displayed:

```text
920 × 2044
```

### VUI

VUI parameters are present:

```text
Video format:              0
Full range:                false
Colour primaries:          1
Transfer characteristics:  1
Matrix coefficients:       1
```

---

## 4. PPS

Observed PPS:

```text
68 CE 01 A8 35 C8 00 00 00 00 38 04 00 00 60 09
00 00 00 00 00 00 30 75 00 00 00 00 00 00 ...
```

The PPS is:

```text
PPS ID:                   0
SPS ID:                   0
Entropy coding:           CAVLC
Bottom field POC:         false
Slice groups:              1
Default L0 references:     1
Default L1 references:     1
Weighted P:                false
Weighted B mode:           0
Initial QP offset:        -26
Initial QS offset:        -26
Chroma QP offset:          0
Deblocking control:        true
Constrained intra:         false
Redundant pictures:        false
```

An important observation is that the encoder uses **CAVLC**, not CABAC.

The PPS contents are not always byte-for-byte identical between captures, despite retaining the same basic parameters.

---

## 5. Slice Headers

Slice headers are successfully being decoded.

### IDR

Example:

```text
NAL type:                 5
NAL size:                 ~66 KB
nal_ref_idc:              3

first_mb_in_slice:        0
slice_type:               I
pic_parameter_set_id:     0
frame_num:                0
idr_pic_id:               0
```

A subsequent IDR:

```text
frame_num:                0
idr_pic_id:               1
```

This demonstrates that the two IDRs are distinct pictures even though both begin with `frame_num = 0`.

### P-frames

Observed P-frame sequence:

```text
frame_num = 1
frame_num = 2
frame_num = 3
...
```

Each observed P-frame has:

```text
first_mb_in_slice = 0
slice_type = 0 (P)
pps_id = 0
nal_ref_idc = 3
```

The stream therefore appears to contain one slice per frame rather than multiple slices covering different portions of a frame.

---

## 6. Frame / NAL Sizes

P-frame sizes vary dramatically depending on frame contents.

Examples:

```text
~700 bytes
~1 KB
~3 KB
~7 KB
~27 KB
~48 KB
~90 KB
~107 KB
~145 KB
```

This is expected for inter-frame H.264 compression: mostly-static frames can be tiny while frames containing substantial visual changes become much larger.

The observed `first_mb_in_slice = 0` for each P-frame is consistent with each NAL representing a complete frame slice.

---

## 7. IDR Payload Investigation

An IDR NAL was inspected after removing the NAL header and emulation-prevention bytes.

Example:

```text
NAL size:       66888 bytes
NAL header:     0x65
nal_ref_idc:    3
nal_unit_type:  5
RBSP size:      66886 bytes
```

The complete slice header currently decodes correctly:

```text
first_mb_in_slice:        0
slice_type:               I
pic_parameter_set_id:     0
frame_num:                0
idr_pic_id:               0
```

For the first IDR, the parser reaches:

```text
Current bit position:     24
Current byte position:    3
```

For the second IDR:

```text
Current bit position:     26
Current byte position:    3
```

This difference is explained by the different `idr_pic_id` values.

### Important

The bytes immediately following the parsed slice header are **not yet independently decoded**.

The current inspection point is only the beginning of:

```text
slice_data()
```

It is therefore incorrect to treat the first observed bits after the header as a confirmed CAVLC macroblock field.

The actual boundary into `slice_data()` requires the complete H.264 slice-header syntax using the active SPS/PPS.

---

## 8. Current Conclusions

We have established that:

1. The stream is H.264/AVC.
2. It uses Annex-B NAL units.
3. SPS/PPS are valid and consistently reference IDs `0`.
4. The video is Baseline Profile, Level 4.2.
5. The coded frame size is `928 × 2048`.
6. SPS cropping produces `920 × 2044`.
7. The stream uses 4:2:0 8-bit video.
8. The PPS specifies CAVLC entropy coding.
9. IDR and P-frame slice headers can be parsed successfully.
10. P-frames increment `frame_num` normally.
11. Each observed frame begins with `first_mb_in_slice = 0`.
12. The large and variable NAL sizes are consistent with normal H.264 frame compression.
13. The next unexplored layer is the actual **CAVLC `slice_data()` / macroblock syntax**.

---

## 9. Next Investigation

The next step is **not** further SPS/PPS inspection.

We should implement enough of H.264 CAVLC `slice_data()` to determine:

```text
slice_data
  → macroblock layer
  → macroblock type
  → prediction information
  → residual data
```

The immediate goal is to verify that the bitstream can be consumed correctly from the end of the slice header and that the parser can advance through the macroblocks corresponding to:

```text
58 × 128 = 7424 macroblocks
```

for the coded `928 × 2048` frame.

Once this works, we can investigate whether the stream can be decoded directly, reconstructed manually, or efficiently passed to an existing H.264 decoder.

### Additional NAL Stream Findings

A low-verbosity capture confirmed that the stream contains unexpected NAL unit
types interspersed with normal P slices.

Observed:
- SPS (`type=7`) at stream start.
- Normal P slices (`type=1`, `ref=3`).
- `type=0`, `type=23`, and `type=31` NAL units were also observed.
- Some unusual units have non-standard `nal_ref_idc` values (`0` or `1`/`2`).
- P-slice sizes vary dramatically, from a few dozen bytes to very large
  slices observed in earlier captures.
- Therefore the stream should not yet be treated as a simple
  `SPS/PPS -> IDR -> P -> P -> ...` sequence.

The meaning of the unexpected NAL types remains unresolved. They should be
investigated before implementing assumptions about frame boundaries or
discarding them.