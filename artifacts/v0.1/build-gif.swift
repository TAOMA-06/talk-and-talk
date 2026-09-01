import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 4 else {
  fputs("usage: swift build-gif.swift OUTPUT.gif FRAME.png...\n", stderr)
  exit(2)
}

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let frames = CommandLine.arguments.dropFirst(2).map { URL(fileURLWithPath: $0) }
guard let destination = CGImageDestinationCreateWithURL(
  output as CFURL,
  UTType.gif.identifier as CFString,
  frames.count,
  nil
) else {
  fputs("unable to create GIF destination\n", stderr)
  exit(3)
}

let gifProperties: [CFString: Any] = [
  kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
]
CGImageDestinationSetProperties(destination, gifProperties as CFDictionary)

for (index, frameURL) in frames.enumerated() {
  guard
    let source = CGImageSourceCreateWithURL(frameURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    fputs("unable to read frame: \(frameURL.path)\n", stderr)
    exit(4)
  }
  let delay = index == frames.count - 1 ? 1.1 : 0.14
  let frameProperties: [CFString: Any] = [
    kCGImagePropertyGIFDictionary: [
      kCGImagePropertyGIFDelayTime: delay,
      kCGImagePropertyGIFUnclampedDelayTime: delay
    ]
  ]
  CGImageDestinationAddImage(destination, image, frameProperties as CFDictionary)
}

guard CGImageDestinationFinalize(destination) else {
  fputs("unable to finalize GIF\n", stderr)
  exit(5)
}

print("wrote \(output.path) with \(frames.count) frames")
