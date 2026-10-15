#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libavutil/mem.h>
#include <libswscale/swscale.h>

#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct LinuxDecoder LinuxDecoder;

struct LinuxDecoder {
  AVCodecContext* context;
  AVPacket* packet;
  AVFrame* frame;
  struct SwsContext* scaler;
};

void linux_decoder_destroy(LinuxDecoder* decoder);

LinuxDecoder* linux_decoder_create(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size) {
  if (sps == NULL || pps == NULL || sps_size == 0 || pps_size == 0 ||
      sps_size + pps_size > 16 * 1024 * 1024) {
    return NULL;
  }
  const AVCodec* codec = avcodec_find_decoder(AV_CODEC_ID_H264);
  if (codec == NULL) {
    return NULL;
  }
  LinuxDecoder* decoder = calloc(1, sizeof(LinuxDecoder));
  if (decoder == NULL) {
    return NULL;
  }
  decoder->context = avcodec_alloc_context3(codec);
  decoder->packet = av_packet_alloc();
  decoder->frame = av_frame_alloc();
  if (decoder->context == NULL || decoder->packet == NULL || decoder->frame == NULL) {
    linux_decoder_destroy(decoder);
    return NULL;
  }

  const uint8_t start_code[] = {0, 0, 0, 1};
  size_t extradata_size = sizeof(start_code) * 2 + sps_size + pps_size;
  decoder->context->extradata = av_mallocz(extradata_size + AV_INPUT_BUFFER_PADDING_SIZE);
  if (decoder->context->extradata == NULL) {
    linux_decoder_destroy(decoder);
    return NULL;
  }
  uint8_t* destination = decoder->context->extradata;
  memcpy(destination, start_code, sizeof(start_code));
  destination += sizeof(start_code);
  memcpy(destination, sps, sps_size);
  destination += sps_size;
  memcpy(destination, start_code, sizeof(start_code));
  destination += sizeof(start_code);
  memcpy(destination, pps, pps_size);
  decoder->context->extradata_size = (int)extradata_size;
  decoder->context->pkt_timebase = (AVRational){1, 1000000};
  decoder->context->thread_count = 1;
  decoder->context->flags |= AV_CODEC_FLAG_LOW_DELAY;
  decoder->context->flags2 |= AV_CODEC_FLAG2_FAST;

  if (avcodec_open2(decoder->context, codec, NULL) < 0) {
    linux_decoder_destroy(decoder);
    return NULL;
  }
  return decoder;
}

void linux_decoder_destroy(LinuxDecoder* decoder) {
  if (decoder == NULL) {
    return;
  }
  sws_freeContext(decoder->scaler);
  av_frame_free(&decoder->frame);
  av_packet_free(&decoder->packet);
  avcodec_free_context(&decoder->context);
  free(decoder);
}

static int copy_frame_rgba(LinuxDecoder* decoder, uint8_t** pixels, int* width, int* height) {
  int frame_width = decoder->frame->width;
  int frame_height = decoder->frame->height;
  if (frame_width <= 0 || frame_height <= 0 || frame_width > 16384 || frame_height > 16384) {
    return -1;
  }

  decoder->scaler = sws_getCachedContext(
      decoder->scaler,
      frame_width,
      frame_height,
      decoder->frame->format,
      frame_width,
      frame_height,
      AV_PIX_FMT_RGBA,
      SWS_FAST_BILINEAR,
      NULL,
      NULL,
      NULL);
  if (decoder->scaler == NULL) {
    return -1;
  }

  size_t stride = (size_t)frame_width * 4;
  uint8_t* output = malloc(stride * frame_height);
  if (output == NULL) {
    return -1;
  }
  uint8_t* output_planes[] = {output, NULL, NULL, NULL};
  int output_strides[] = {(int)stride, 0, 0, 0};
  int rows = sws_scale(decoder->scaler,
                       (const uint8_t* const*)decoder->frame->data,
                       decoder->frame->linesize,
                       0,
                       frame_height,
                       output_planes,
                       output_strides);
  if (rows != frame_height) {
    free(output);
    return -1;
  }
  *pixels = output;
  *width = frame_width;
  *height = frame_height;
  return 1;
}

int linux_decoder_decode(LinuxDecoder* decoder, const uint8_t* data, size_t size, int64_t timestamp_us,
                         uint8_t** pixels, int* width, int* height) {
  if (decoder == NULL || data == NULL || size == 0 || size > INT_MAX) {
    return -1;
  }
  av_packet_unref(decoder->packet);
  if (av_new_packet(decoder->packet, (int)size) < 0) {
    return -1;
  }
  memcpy(decoder->packet->data, data, size);
  decoder->packet->pts = timestamp_us;
  decoder->packet->dts = AV_NOPTS_VALUE;
  if (avcodec_send_packet(decoder->context, decoder->packet) < 0) {
    av_packet_unref(decoder->packet);
    return -1;
  }
  av_packet_unref(decoder->packet);

  int result = 0;
  while (1) {
    int status = avcodec_receive_frame(decoder->context, decoder->frame);
    if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) {
      break;
    }
    if (status < 0) {
      if (result == 0) {
        result = -1;
      }
      break;
    }

    uint8_t* next_pixels = NULL;
    int next_width = 0;
    int next_height = 0;
    int copy_status = copy_frame_rgba(decoder, &next_pixels, &next_width, &next_height);
    av_frame_unref(decoder->frame);
    if (copy_status < 0) {
      free(*pixels);
      *pixels = NULL;
      return -1;
    }
    free(*pixels);
    *pixels = next_pixels;
    *width = next_width;
    *height = next_height;
    result = 1;
  }
  return result;
}

void linux_decoder_free_buffer(uint8_t* buffer) {
  free(buffer);
}
