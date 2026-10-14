#include <CoreFoundation/CoreFoundation.h>
#include <CoreMedia/CoreMedia.h>
#include <CoreVideo/CoreVideo.h>
#include <VideoToolbox/VideoToolbox.h>
#include <Accelerate/Accelerate.h>
#include <stdlib.h>
#include <string.h>

typedef struct VTDecoder {
  CMVideoFormatDescriptionRef format;
  VTDecompressionSessionRef session;
  CVPixelBufferRef frame;
  OSStatus callback_status;
} VTDecoder;

static void DecoderOutput(void* context, void* source_frame, OSStatus status, VTDecodeInfoFlags info,
                          CVImageBufferRef image, CMTime presentation_time, CMTime duration) {
  VTDecoder* decoder = (VTDecoder*)context;
  decoder->callback_status = status;
  if (status != noErr || image == NULL) {
    return;
  }
  if (decoder->frame != NULL) {
    CVPixelBufferRelease(decoder->frame);
  }
  decoder->frame = CVPixelBufferRetain((CVPixelBufferRef)image);
}

VTDecoder* vt_decoder_create(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size) {
  VTDecoder* decoder = calloc(1, sizeof(VTDecoder));
  if (decoder == NULL) {
    return NULL;
  }

  const uint8_t* parameter_sets[] = {sps, pps};
  size_t parameter_set_sizes[] = {sps_size, pps_size};
  OSStatus status = CMVideoFormatDescriptionCreateFromH264ParameterSets(
      kCFAllocatorDefault, 2, parameter_sets, parameter_set_sizes, 4, &decoder->format);
  if (status != noErr) {
    free(decoder);
    return NULL;
  }

  int pixel_format = kCVPixelFormatType_32BGRA;
  CFNumberRef pixel_format_number = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &pixel_format);
  const void* keys[] = {kCVPixelBufferPixelFormatTypeKey};
  const void* values[] = {pixel_format_number};
  CFDictionaryRef attributes = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
                                                    &kCFTypeDictionaryKeyCallBacks,
                                                    &kCFTypeDictionaryValueCallBacks);
  VTDecompressionOutputCallbackRecord callback = {DecoderOutput, decoder};
  status = VTDecompressionSessionCreate(kCFAllocatorDefault, decoder->format, NULL, attributes, &callback,
                                        &decoder->session);
  CFRelease(attributes);
  CFRelease(pixel_format_number);
  if (status != noErr) {
    CFRelease(decoder->format);
    free(decoder);
    return NULL;
  }
  return decoder;
}

void vt_decoder_destroy(VTDecoder* decoder) {
  if (decoder == NULL) {
    return;
  }
  if (decoder->session != NULL) {
    VTDecompressionSessionInvalidate(decoder->session);
    CFRelease(decoder->session);
  }
  if (decoder->format != NULL) {
    CFRelease(decoder->format);
  }
  if (decoder->frame != NULL) {
    CVPixelBufferRelease(decoder->frame);
  }
  free(decoder);
}

int vt_decoder_decode(VTDecoder* decoder, const uint8_t* data, size_t size, int64_t timestamp_us,
                      uint8_t** pixels, int* width, int* height) {
  if (decoder == NULL || data == NULL || size == 0) {
    return -1;
  }
  if (decoder->frame != NULL) {
    CVPixelBufferRelease(decoder->frame);
    decoder->frame = NULL;
  }
  decoder->callback_status = noErr;

  CMBlockBufferRef block = NULL;
  OSStatus status = CMBlockBufferCreateWithMemoryBlock(kCFAllocatorDefault, (void*)data, size, kCFAllocatorNull,
                                                        NULL, 0, size, 0, &block);
  if (status != kCMBlockBufferNoErr) {
    return -1;
  }
  size_t sample_size = size;
  CMSampleTimingInfo timing = {kCMTimeInvalid, CMTimeMake(timestamp_us, 1000000), kCMTimeInvalid};
  CMSampleBufferRef sample = NULL;
  status = CMSampleBufferCreateReady(kCFAllocatorDefault, block, decoder->format, 1, 1, &timing, 1,
                                     &sample_size, &sample);
  CFRelease(block);
  if (status != noErr) {
    return -1;
  }

  VTDecodeInfoFlags info = 0;
  // Zero flags keep decoding synchronous while data points into Go-owned memory.
  status = VTDecompressionSessionDecodeFrame(decoder->session, sample, 0, NULL, &info);
  CFRelease(sample);
  if (status != noErr || decoder->callback_status != noErr) {
    return -1;
  }
  if (decoder->frame == NULL) {
    return 0;
  }

  CVPixelBufferRef frame = decoder->frame;
  if (CVPixelBufferLockBaseAddress(frame, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) {
    return -1;
  }
  size_t frame_width = CVPixelBufferGetWidth(frame);
  size_t frame_height = CVPixelBufferGetHeight(frame);
  size_t row_bytes = CVPixelBufferGetBytesPerRow(frame);
  uint8_t* base = CVPixelBufferGetBaseAddress(frame);
  uint8_t* copy = malloc(frame_width * frame_height * 4);
  if (base == NULL || copy == NULL) {
    free(copy);
    CVPixelBufferUnlockBaseAddress(frame, kCVPixelBufferLock_ReadOnly);
    return -1;
  }
  vImage_Buffer source = {base, frame_height, frame_width, row_bytes};
  vImage_Buffer destination = {copy, frame_height, frame_width, frame_width * 4};
  const uint8_t channels[] = {2, 1, 0, 3};
  vImagePermuteChannels_ARGB8888(&source, &destination, channels, kvImageDoNotTile);
  CVPixelBufferUnlockBaseAddress(frame, kCVPixelBufferLock_ReadOnly);
  *pixels = copy;
  *width = (int)frame_width;
  *height = (int)frame_height;
  return 1;
}

void vt_decoder_free_buffer(uint8_t* buffer) {
  free(buffer);
}
