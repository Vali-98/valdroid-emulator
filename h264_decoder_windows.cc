#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mftransform.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>

struct MFDecoder {
  IMFTransform* transform = nullptr;
  UINT32 width = 0;
  UINT32 height = 0;
  LONG stride = 0;
  UINT32 color_matrix = 1;
  UINT32 nominal_range = 2;
  bool com_initialized = false;
  bool mf_started = false;
};

static HRESULT SetOutputType(MFDecoder* decoder) {
  for (DWORD index = 0;; ++index) {
    IMFMediaType* output_type = nullptr;
    HRESULT status = decoder->transform->GetOutputAvailableType(0, index, &output_type);
    if (FAILED(status)) {
      return status;
    }
    GUID subtype = GUID_NULL;
    status = output_type->GetGUID(MF_MT_SUBTYPE, &subtype);
    if (SUCCEEDED(status) && subtype == MFVideoFormat_NV12) {
      status = output_type->SetUINT64(MF_MT_FRAME_SIZE, (static_cast<UINT64>(decoder->width) << 32) | decoder->height);
      if (SUCCEEDED(status)) {
        status = decoder->transform->SetOutputType(0, output_type, 0);
      }
      if (SUCCEEDED(status)) {
        UINT32 stride = 0;
        if (SUCCEEDED(output_type->GetUINT32(MF_MT_DEFAULT_STRIDE, &stride))) {
          decoder->stride = static_cast<LONG>(stride);
        } else {
          decoder->stride = static_cast<LONG>(decoder->width);
        }
        output_type->GetUINT32(MF_MT_YUV_MATRIX, &decoder->color_matrix);
        output_type->GetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, &decoder->nominal_range);
        output_type->Release();
        return S_OK;
      }
    }
    output_type->Release();
  }
}

static HRESULT CreateInputSample(const uint8_t* data, size_t size, int64_t timestamp_us, IMFSample** sample) {
  IMFMediaBuffer* buffer = nullptr;
  HRESULT status = MFCreateSample(sample);
  if (FAILED(status)) {
    return status;
  }
  status = MFCreateMemoryBuffer(static_cast<DWORD>(size), &buffer);
  if (FAILED(status)) {
    (*sample)->Release();
    *sample = nullptr;
    return status;
  }
  BYTE* destination = nullptr;
  DWORD maximum_length = 0;
  DWORD current_length = 0;
  status = buffer->Lock(&destination, &maximum_length, &current_length);
  if (SUCCEEDED(status)) {
    if (maximum_length < size) {
      status = E_INVALIDARG;
    } else {
      memcpy(destination, data, size);
      status = buffer->SetCurrentLength(static_cast<DWORD>(size));
    }
    buffer->Unlock();
  }
  if (SUCCEEDED(status)) {
    status = (*sample)->AddBuffer(buffer);
  }
  buffer->Release();
  if (SUCCEEDED(status)) {
    status = (*sample)->SetSampleTime(timestamp_us * 10);
  }
  if (FAILED(status)) {
    (*sample)->Release();
    *sample = nullptr;
  }
  return status;
}

MFDecoder* mf_decoder_create(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size,
                             int width, int height) {
  if (sps == nullptr || pps == nullptr || sps_size == 0 || pps_size == 0 || width <= 0 || height <= 0) {
    return nullptr;
  }
  MFDecoder* decoder = new MFDecoder();
  decoder->width = static_cast<UINT32>(width);
  decoder->height = static_cast<UINT32>(height);
  decoder->stride = width * 4;

  HRESULT status = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (SUCCEEDED(status)) {
    decoder->com_initialized = true;
  } else if (status != RPC_E_CHANGED_MODE) {
    delete decoder;
    return nullptr;
  }
  status = MFStartup(MF_VERSION, MFSTARTUP_LITE);
  if (FAILED(status)) {
    if (decoder->com_initialized) CoUninitialize();
    delete decoder;
    return nullptr;
  }
  decoder->mf_started = true;

  MFT_REGISTER_TYPE_INFO input_info = {MFMediaType_Video, MFVideoFormat_H264};
  MFT_REGISTER_TYPE_INFO output_info = {MFMediaType_Video, MFVideoFormat_NV12};
  IMFActivate** activations = nullptr;
  UINT32 activation_count = 0;
  status = MFTEnumEx(MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
                     &input_info, &output_info, &activations, &activation_count);
  if (FAILED(status) || activation_count == 0) {
    if (activations != nullptr) CoTaskMemFree(activations);
    MFShutdown();
    if (decoder->com_initialized) CoUninitialize();
    delete decoder;
    return nullptr;
  }
  status = activations[0]->ActivateObject(IID_PPV_ARGS(&decoder->transform));
  for (UINT32 i = 0; i < activation_count; ++i) {
    activations[i]->Release();
  }
  CoTaskMemFree(activations);
  if (FAILED(status)) {
    MFShutdown();
    if (decoder->com_initialized) CoUninitialize();
    delete decoder;
    return nullptr;
  }

  IMFMediaType* input_type = nullptr;
  status = MFCreateMediaType(&input_type);
  if (SUCCEEDED(status)) status = input_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  if (SUCCEEDED(status)) status = input_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
  if (SUCCEEDED(status)) status = input_type->SetUINT64(MF_MT_FRAME_SIZE, (static_cast<UINT64>(width) << 32) | height);
  if (SUCCEEDED(status)) status = input_type->SetUINT64(MF_MT_FRAME_RATE, (static_cast<UINT64>(60) << 32) | 1);
  if (SUCCEEDED(status)) status = input_type->SetUINT64(MF_MT_PIXEL_ASPECT_RATIO, (static_cast<UINT64>(1) << 32) | 1);
  if (SUCCEEDED(status)) status = input_type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  std::vector<uint8_t> sequence_header;
  const uint8_t start_code[] = {0, 0, 0, 1};
  sequence_header.insert(sequence_header.end(), start_code, start_code + sizeof(start_code));
  sequence_header.insert(sequence_header.end(), sps, sps + sps_size);
  sequence_header.insert(sequence_header.end(), start_code, start_code + sizeof(start_code));
  sequence_header.insert(sequence_header.end(), pps, pps + pps_size);
  if (SUCCEEDED(status)) {
    status = input_type->SetBlob(MF_MT_MPEG_SEQUENCE_HEADER, sequence_header.data(),
                                 static_cast<UINT32>(sequence_header.size()));
  }
  if (SUCCEEDED(status)) status = decoder->transform->SetInputType(0, input_type, 0);
  if (input_type != nullptr) input_type->Release();
  if (SUCCEEDED(status)) status = SetOutputType(decoder);
  if (SUCCEEDED(status)) status = decoder->transform->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
  if (SUCCEEDED(status)) status = decoder->transform->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  if (FAILED(status)) {
    decoder->transform->Release();
    MFShutdown();
    if (decoder->com_initialized) CoUninitialize();
    delete decoder;
    return nullptr;
  }
  return decoder;
}

void mf_decoder_destroy(MFDecoder* decoder) {
  if (decoder == nullptr) return;
  if (decoder->transform != nullptr) {
    decoder->transform->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
    decoder->transform->Release();
  }
  if (decoder->mf_started) MFShutdown();
  if (decoder->com_initialized) CoUninitialize();
  delete decoder;
}

int mf_decoder_decode(MFDecoder* decoder, const uint8_t* data, size_t size, int64_t timestamp_us,
                      uint8_t** pixels, int* width, int* height) {
  if (decoder == nullptr || data == nullptr || size == 0) return -1;
  IMFSample* input_sample = nullptr;
  HRESULT status = CreateInputSample(data, size, timestamp_us, &input_sample);
  if (FAILED(status)) return -1;
  status = decoder->transform->ProcessInput(0, input_sample, 0);
  input_sample->Release();
  if (FAILED(status)) return -1;

  MFT_OUTPUT_STREAM_INFO stream_info = {};
  status = decoder->transform->GetOutputStreamInfo(0, &stream_info);
  if (FAILED(status)) return -1;
  IMFSample* output_sample = nullptr;
  IMFMediaBuffer* output_buffer = nullptr;
  if ((stream_info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) == 0) {
    status = MFCreateSample(&output_sample);
    if (SUCCEEDED(status)) {
      status = MFCreateMemoryBuffer(max(stream_info.cbSize, decoder->width * decoder->height * 4), &output_buffer);
    }
    if (SUCCEEDED(status)) status = output_sample->AddBuffer(output_buffer);
    if (FAILED(status)) {
      if (output_buffer != nullptr) output_buffer->Release();
      if (output_sample != nullptr) output_sample->Release();
      return -1;
    }
    output_buffer->Release();
  }
  MFT_OUTPUT_DATA_BUFFER output = {};
  output.dwStreamID = 0;
  output.pSample = output_sample;
  DWORD status_flags = 0;
  status = decoder->transform->ProcessOutput(0, 1, &output, &status_flags);
  if (output.pEvents != nullptr) output.pEvents->Release();
  IMFSample* decoded_sample = output.pSample;
  if (output_sample != nullptr && output_sample != decoded_sample) output_sample->Release();
  if (status == MF_E_TRANSFORM_NEED_MORE_INPUT) {
    if (decoded_sample != nullptr) decoded_sample->Release();
    return 0;
  }
  if (status == MF_E_TRANSFORM_STREAM_CHANGE) {
    if (decoded_sample != nullptr) decoded_sample->Release();
    return SetOutputType(decoder) == S_OK ? 0 : -1;
  }
  if (FAILED(status) || decoded_sample == nullptr) {
    if (decoded_sample != nullptr) decoded_sample->Release();
    return -1;
  }

  IMFMediaBuffer* decoded_buffer = nullptr;
  status = decoded_sample->ConvertToContiguousBuffer(&decoded_buffer);
  if (FAILED(status)) {
    decoded_sample->Release();
    return -1;
  }
  BYTE* base = nullptr;
  DWORD maximum_length = 0;
  DWORD current_length = 0;
  status = decoded_buffer->Lock(&base, &maximum_length, &current_length);
  if (FAILED(status)) {
    decoded_buffer->Release();
    decoded_sample->Release();
    return -1;
  }

  size_t stride = static_cast<size_t>(decoder->stride > 0 ? decoder->stride : decoder->width);
  size_t chroma_offset = stride * decoder->height;
  size_t required_size = chroma_offset + stride * ((decoder->height + 1) / 2);
  size_t output_size = static_cast<size_t>(decoder->width) * decoder->height * 4;
  uint8_t* copy = static_cast<uint8_t*>(malloc(output_size));
  if (copy == nullptr || base == nullptr || current_length < required_size || stride < decoder->width) {
    free(copy);
    decoded_buffer->Unlock();
    decoded_buffer->Release();
    decoded_sample->Release();
    return -1;
  }
  for (UINT32 row = 0; row < decoder->height; ++row) {
    const uint8_t* luma = base + row * stride;
    const uint8_t* chroma = base + chroma_offset + (row / 2) * stride;
    for (UINT32 column = 0; column < decoder->width; ++column) {
      int y = luma[column];
      int u = chroma[column & ~1U] - 128;
      int v = chroma[(column & ~1U) + 1] - 128;
      int red;
      int green;
      int blue;
      if (decoder->nominal_range == 1) {
        if (decoder->color_matrix == 2) {
          red = y + ((359 * v + 128) >> 8);
          green = y - ((88 * u + 183 * v + 128) >> 8);
          blue = y + ((454 * u + 128) >> 8);
        } else {
          red = y + ((403 * v + 128) >> 8);
          green = y - ((48 * u + 120 * v + 128) >> 8);
          blue = y + ((475 * u + 128) >> 8);
        }
      } else {
        int luma_value = max(0, y - 16);
        if (decoder->color_matrix == 2) {
          red = (298 * luma_value + 409 * v + 128) >> 8;
          green = (298 * luma_value - 100 * u - 208 * v + 128) >> 8;
          blue = (298 * luma_value + 516 * u + 128) >> 8;
        } else {
          red = (298 * luma_value + 459 * v + 128) >> 8;
          green = (298 * luma_value - 55 * u - 136 * v + 128) >> 8;
          blue = (298 * luma_value + 541 * u + 128) >> 8;
        }
      }
      size_t destination = (static_cast<size_t>(row) * decoder->width + column) * 4;
      copy[destination] = static_cast<uint8_t>(min(255, max(0, blue)));
      copy[destination + 1] = static_cast<uint8_t>(min(255, max(0, green)));
      copy[destination + 2] = static_cast<uint8_t>(min(255, max(0, red)));
      copy[destination + 3] = 255;
    }
  }
  decoded_buffer->Unlock();
  decoded_buffer->Release();
  LONGLONG output_time = timestamp_us * 10;
  decoded_sample->GetSampleTime(&output_time);
  decoded_sample->Release();

  *pixels = copy;
  *width = static_cast<int>(decoder->width);
  *height = static_cast<int>(decoder->height);
  return 1;
}

void mf_decoder_free_buffer(uint8_t* buffer) {
  free(buffer);
}