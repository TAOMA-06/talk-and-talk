import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

struct Shot {
    let relativePath: String
    let repeats: Int
}

let scriptURL = URL(fileURLWithPath: #filePath).standardizedFileURL
let releaseDirectory = scriptURL.deletingLastPathComponent()
let repositoryRoot = releaseDirectory
    .deletingLastPathComponent()
    .deletingLastPathComponent()
let outputURL = releaseDirectory.appendingPathComponent("talktalk-v0.1-motion-demo.mp4")

let width = 540
let height = 928
let fps: Int32 = 12
let shots = [
    Shot(relativePath: "artifacts/ui4-visual-evidence/dynamic/home-scene-deal/frame-01.png", repeats: 2),
    Shot(relativePath: "artifacts/ui4-visual-evidence/dynamic/home-scene-deal/frame-02.png", repeats: 3),
    Shot(relativePath: "artifacts/ui4-visual-evidence/dynamic/home-scene-deal/frame-03.png", repeats: 4),
    Shot(relativePath: "artifacts/ui4-visual-evidence/dynamic/home-scene-deal/frame-04.png", repeats: 7),
    Shot(relativePath: "artifacts/ui4-visual-evidence/dynamic/home-scene-deal/frame-05.png", repeats: 10),
    Shot(relativePath: "artifacts/ui4-visual-evidence/dynamic/home-scene-deal/settled-a.png", repeats: 12),
]

enum DemoError: LocalizedError {
    case cannotDecode(String)
    case cannotCreatePixelBuffer
    case cannotCreateContext
    case cannotAddWriterInput
    case writerFailed(String)
    case cannotDecodeOutput(String)

    var errorDescription: String? {
        switch self {
        case let .cannotDecode(path):
            return "Cannot decode source frame: \(path)"
        case .cannotCreatePixelBuffer:
            return "Cannot create video pixel buffer"
        case .cannotCreateContext:
            return "Cannot create bitmap context"
        case .cannotAddWriterInput:
            return "Cannot add H.264 writer input"
        case let .writerFailed(message):
            return "Video writer failed: \(message)"
        case let .cannotDecodeOutput(message):
            return "Encoded MP4 could not be decoded: \(message)"
        }
    }
}

func makePixelBuffer(from sourceURL: URL) throws -> CVPixelBuffer {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw DemoError.cannotDecode(sourceURL.path)
    }

    var pixelBuffer: CVPixelBuffer?
    let attributes: [CFString: Any] = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        kCVPixelBufferIOSurfacePropertiesKey: [:],
    ]
    let result = CVPixelBufferCreate(
        kCFAllocatorDefault,
        width,
        height,
        kCVPixelFormatType_32BGRA,
        attributes as CFDictionary,
        &pixelBuffer
    )
    guard result == kCVReturnSuccess, let buffer = pixelBuffer else {
        throw DemoError.cannotCreatePixelBuffer
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer),
          let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
              data: baseAddress,
              width: width,
              height: height,
              bitsPerComponent: 8,
              bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
              space: colorSpace,
              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                  | CGBitmapInfo.byteOrder32Little.rawValue
          )
    else {
        throw DemoError.cannotCreateContext
    }

    context.setFillColor(CGColor(red: 0.976, green: 0.969, blue: 0.949, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high

    // DevTools capture adds a narrow viewport scrollbar at the far right. The
    // release demo trims only that chrome; the product pixels are otherwise
    // the deterministic captured frames listed above.
    let trimmedImage = image.cropping(to: CGRect(
        x: 0,
        y: 0,
        width: max(1, image.width - 18),
        height: image.height
    )) ?? image

    let scale = min(
        CGFloat(width) / CGFloat(trimmedImage.width),
        CGFloat(height) / CGFloat(trimmedImage.height)
    )
    let drawWidth = CGFloat(trimmedImage.width) * scale
    let drawHeight = CGFloat(trimmedImage.height) * scale
    let drawRect = CGRect(
        x: (CGFloat(width) - drawWidth) / 2,
        y: (CGFloat(height) - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight
    )
    context.draw(trimmedImage, in: drawRect)
    return buffer
}

do {
    for shot in shots {
        let sourceURL = repositoryRoot.appendingPathComponent(shot.relativePath)
        guard FileManager.default.fileExists(atPath: sourceURL.path) else {
            throw DemoError.cannotDecode(shot.relativePath)
        }
    }

    if FileManager.default.fileExists(atPath: outputURL.path) {
        try FileManager.default.removeItem(at: outputURL)
    }

    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let outputSettings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 1_800_000,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel,
        ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
    )

    guard writer.canAdd(input) else {
        throw DemoError.cannotAddWriterInput
    }
    writer.add(input)
    guard writer.startWriting() else {
        throw DemoError.writerFailed(writer.error?.localizedDescription ?? "startWriting returned false")
    }
    writer.startSession(atSourceTime: .zero)

    var frameIndex: Int64 = 0
    for shot in shots {
        let sourceURL = repositoryRoot.appendingPathComponent(shot.relativePath)
        let pixelBuffer = try makePixelBuffer(from: sourceURL)
        for _ in 0 ..< shot.repeats {
            while !input.isReadyForMoreMediaData {
                try await Task.sleep(for: .milliseconds(5))
            }
            let presentationTime = CMTime(value: frameIndex, timescale: fps)
            guard adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
                throw DemoError.writerFailed(writer.error?.localizedDescription ?? "append returned false")
            }
            frameIndex += 1
        }
    }

    input.markAsFinished()
    let completion = DispatchSemaphore(value: 0)
    writer.finishWriting { completion.signal() }
    completion.wait()
    guard writer.status == .completed else {
        throw DemoError.writerFailed(writer.error?.localizedDescription ?? "finishWriting did not complete")
    }

    let asset = AVURLAsset(url: outputURL)
    let imageGenerator = AVAssetImageGenerator(asset: asset)
    imageGenerator.appliesPreferredTrackTransform = true
    do {
        _ = try await imageGenerator.image(
            at: CMTime(seconds: 1, preferredTimescale: 600)
        ).image
    } catch {
        throw DemoError.cannotDecodeOutput(error.localizedDescription)
    }

    let duration = Double(frameIndex) / Double(fps)
    let fileSize = try FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber
    let summary: [String: Any] = [
        "output": "artifacts/v0.1/talktalk-v0.1-motion-demo.mp4",
        "codec": "H.264",
        "width": width,
        "height": height,
        "fps": fps,
        "frames": frameIndex,
        "durationSeconds": duration,
        "bytes": fileSize?.intValue ?? 0,
        "source": "deterministic WeChat DevTools UI4 motion frames",
        "businessState": "legal-only local fixture; no real identity, order, or payment data",
    ]
    let data = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    fputs("build-motion-demo: \(error.localizedDescription)\n", stderr)
    exit(1)
}
