import AppKit
import AVFoundation
import CoreImage
import Foundation

enum ToolError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(value) = self { return value }; return nil }
}

struct Options {
    let input: URL
    let output: URL
    let overwrite: Bool
}

func parseOptions() throws -> Options {
    var input: String?
    var output: String?
    var overwrite = false
    var index = 1
    while index < CommandLine.arguments.count {
        switch CommandLine.arguments[index] {
        case "--input": index += 1; input = index < CommandLine.arguments.count ? CommandLine.arguments[index] : nil
        case "--output": index += 1; output = index < CommandLine.arguments.count ? CommandLine.arguments[index] : nil
        case "--overwrite": overwrite = true
        case "--help", "-h": print("Usage: transcode-recording --input raw.mov --output final.mp4 [--overwrite]"); exit(0)
        default: throw ToolError.message("Unknown argument: \(CommandLine.arguments[index])")
        }
        index += 1
    }
    guard let input, input.hasPrefix("/"), let output, output.hasPrefix("/"), output.lowercased().hasSuffix(".mp4") else {
        throw ToolError.message("Absolute --input and .mp4 --output paths are required")
    }
    return Options(input: URL(fileURLWithPath: input), output: URL(fileURLWithPath: output), overwrite: overwrite)
}

func waitUntilReady(_ input: AVAssetWriterInput, writer: AVAssetWriter) throws {
    while !input.isReadyForMoreMediaData {
        if writer.status == .failed { throw ToolError.message(writer.error?.localizedDescription ?? "Writer failed") }
        Thread.sleep(forTimeInterval: 0.002)
    }
}

func render(source: CVPixelBuffer, preferredTransform: CGAffineTransform, destination: CVPixelBuffer, context: CIContext) {
    let outputRect = CGRect(x: 0, y: 0, width: 1_920, height: 1_080)
    var image = CIImage(cvPixelBuffer: source).transformed(by: preferredTransform)
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    let scale = min(outputRect.width / image.extent.width, outputRect.height / image.extent.height)
    image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    image = image.transformed(by: CGAffineTransform(
        translationX: (outputRect.width - image.extent.width) / 2 - image.extent.minX,
        y: (outputRect.height - image.extent.height) / 2 - image.extent.minY
    ))
    let background = CIImage(color: CIColor(red: 0.035, green: 0.065, blue: 0.08, alpha: 1)).cropped(to: outputRect)
    context.render(image.composited(over: background), to: destination, bounds: outputRect, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
}

func run() async throws {
    let options = try parseOptions()
    guard FileManager.default.fileExists(atPath: options.input.path) else { throw ToolError.message("Input not found") }
    let parent = options.output.deletingLastPathComponent()
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue else { throw ToolError.message("Output parent missing") }
    if FileManager.default.fileExists(atPath: options.output.path) {
        guard options.overwrite else { throw ToolError.message("Output exists; pass --overwrite") }
        try FileManager.default.removeItem(at: options.output)
    }

    let asset = AVURLAsset(url: options.input)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw ToolError.message("No video track") }
    let preferredTransform = try await track.load(.preferredTransform)
    let reader = try AVAssetReader(asset: asset)
    let readerOutput = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ])
    readerOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerOutput) else { throw ToolError.message("Cannot add reader output") }
    reader.add(readerOutput)

    let writer = try AVAssetWriter(outputURL: options.output, fileType: .mp4)
    let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: 1_920,
        AVVideoHeightKey: 1_080,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 10_000_000,
            AVVideoExpectedSourceFrameRateKey: 30,
            AVVideoMaxKeyFrameIntervalKey: 60,
            AVVideoAllowFrameReorderingKey: false,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ])
    writerInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: writerInput, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: 1_920,
        kCVPixelBufferHeightKey as String: 1_080,
    ])
    guard writer.canAdd(writerInput) else { throw ToolError.message("Cannot add H.264 writer input") }
    writer.add(writerInput)
    guard reader.startReading(), writer.startWriting() else { throw ToolError.message(reader.error?.localizedDescription ?? writer.error?.localizedDescription ?? "Cannot start media pipeline") }
    writer.startSession(atSourceTime: .zero)

    let ciContext = CIContext(options: [.cacheIntermediates: false])
    var firstPTS: CMTime?
    var nextFrame: Int64 = 0
    while let sample = readerOutput.copyNextSampleBuffer() {
        guard let source = CMSampleBufferGetImageBuffer(sample) else { continue }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        if firstPTS == nil { firstPTS = pts }
        let elapsed = max(0, CMTimeGetSeconds(CMTimeSubtract(pts, firstPTS!)))
        let targetFrame = Int64((elapsed * 30).rounded(.down))
        guard targetFrame >= nextFrame else { continue }
        while nextFrame <= targetFrame {
            try waitUntilReady(writerInput, writer: writer)
            guard let pool = adaptor.pixelBufferPool else { throw ToolError.message("Writer pixel buffer pool unavailable") }
            var destination: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &destination) == kCVReturnSuccess, let destination else {
                throw ToolError.message("Cannot allocate destination frame")
            }
            render(source: source, preferredTransform: preferredTransform, destination: destination, context: ciContext)
            let time = CMTime(value: nextFrame, timescale: 30)
            guard adaptor.append(destination, withPresentationTime: time) else { throw ToolError.message(writer.error?.localizedDescription ?? "Cannot append frame") }
            nextFrame += 1
        }
    }
    guard reader.status == .completed else { throw ToolError.message(reader.error?.localizedDescription ?? "Reader did not complete") }
    writerInput.markAsFinished()
    await writer.finishWriting()
    guard writer.status == .completed else { throw ToolError.message(writer.error?.localizedDescription ?? "Writer did not complete") }
    let result: [String: Any] = ["output": options.output.path, "frames": nextFrame, "durationSeconds": Double(nextFrame) / 30, "width": 1_920, "height": 1_080, "fps": 30, "codec": "H.264"]
    print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
}

@main struct Main {
    static func main() async {
        do { try await run() }
        catch { fputs("transcode-recording: \(error.localizedDescription)\n", stderr); exit(1) }
    }
}
