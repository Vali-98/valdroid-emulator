//go:build darwin && cgo && !turbojpeg

#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>

void* encode_imageio_jpeg(const uint8_t* pixels, int width, int height, int stride, double quality) {
  CGDataProviderRef provider = CGDataProviderCreateWithData(NULL, pixels, (size_t)stride * height, NULL);
  if (provider == NULL) return NULL;
  CGColorSpaceRef colors = CGColorSpaceCreateDeviceRGB();
  CGImageRef image = CGImageCreate(width, height, 8, 32, stride, colors,
      kCGBitmapByteOrderDefault | kCGImageAlphaNoneSkipLast, provider, NULL, false, kCGRenderingIntentDefault);
  CGColorSpaceRelease(colors);
  CGDataProviderRelease(provider);
  if (image == NULL) return NULL;
  CFMutableDataRef data = CFDataCreateMutable(kCFAllocatorDefault, 0);
  CGImageDestinationRef destination = CGImageDestinationCreateWithData(data, CFSTR("public.jpeg"), 1, NULL);
  if (destination == NULL) {CGImageRelease(image); CFRelease(data); return NULL;}
  CFNumberRef level = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &quality);
  const void* keys[] = {kCGImageDestinationLossyCompressionQuality};
  const void* values[] = {level};
  CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
      &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CGImageDestinationAddImage(destination, image, options);
  bool success = CGImageDestinationFinalize(destination);
  CFRelease(options); CFRelease(level); CFRelease(destination); CGImageRelease(image);
  if (!success) {CFRelease(data); return NULL;}
  return (void*)data;
}
const uint8_t* imageio_jpeg_bytes(void* data) {return CFDataGetBytePtr((CFDataRef)data);}
long imageio_jpeg_size(void* data) {return CFDataGetLength((CFDataRef)data);}
void imageio_jpeg_free(void* data) {CFRelease(data);}
