import AppKit
import AVFoundation
import CoreMedia
import Foundation

private enum VerifyError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case let .message(message): return message
        }
    }
}

private struct Options {
    let inputURL: URL
    let reportURL: URL
    let contactSheetURL: URL
    let requestedTimes: [Double]?
    let overwrite: Bool
}

private func fail(_ message: String) throws -> Never {
    throw VerifyError.message(message)
}

private func absoluteURL(_ path: String, label: String) throws -> URL {
    guard path.hasPrefix("/") else { try fail("\(label) must be an absolute path") }
    return URL(fileURLWithPath: path).standardizedFileURL
}

private func parseCLI() throws -> Options {
    var input: String?
    var report: String?
    var contactSheet: String?
    var requestedTimes: [Double]?
    var overwrite = false
    let arguments = CommandLine.arguments
    var index = 1
    while index < arguments.count {
        switch arguments[index] {
        case "--input":
            index += 1
            guard index < arguments.count else { try fail("--input requires a path") }
            input = arguments[index]
        case "--report":
            index += 1
            guard index < arguments.count else { try fail("--report requires a path") }
            report = arguments[index]
        case "--contact-sheet":
            index += 1
            guard index < arguments.count else { try fail("--contact-sheet requires a path") }
            contactSheet = arguments[index]
        case "--times":
            index += 1
            guard index < arguments.count else { try fail("--times requires comma-separated seconds") }
            let values = arguments[index].split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            guard !values.isEmpty else { try fail("--times did not contain valid seconds") }
            requestedTimes = values
        case "--overwrite":
            overwrite = true
        case "--help", "-h":
            print("Usage: verify-video --input /absolute/video.mp4 --report /absolute/report.json --contact-sheet /absolute/contact-sheet.png [--times 1,5,9] [--overwrite]")
            exit(0)
        default:
            try fail("Unknown argument: \(arguments[index])")
        }
        index += 1
    }
    guard let input, let report, let contactSheet else {
        try fail("--input, --report, and --contact-sheet are required")
    }
    return Options(
        inputURL: try absoluteURL(input, label: "Input"),
        reportURL: try absoluteURL(report, label: "Report"),
        contactSheetURL: try absoluteURL(contactSheet, label: "Contact sheet"),
        requestedTimes: requestedTimes,
        overwrite: overwrite
    )
}

private func ensureOutput(_ url: URL, overwrite: Bool) throws {
    let parent = url.deletingLastPathComponent()
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue else {
        try fail("Output parent must already exist: \(parent.path)")
    }
    if FileManager.default.fileExists(atPath: url.path), !overwrite {
        try fail("Output exists; pass --overwrite explicitly: \(url.path)")
    }
}

private func fourCC(_ value: FourCharCode) -> String {
    let scalars = [24, 16, 8, 0].map { shift -> UnicodeScalar in
        let byte = UInt8((value >> FourCharCode(shift)) & 0xff)
        return UnicodeScalar(byte >= 32 && byte <= 126 ? byte : 63)
    }
    return String(String.UnicodeScalarView(scalars))
}

private func codecName(for code: String) -> String {
    switch code {
    case "avc1", "avc3": return "H.264"
    case "hvc1", "hev1": return "HEVC"
    case "apcn": return "Apple ProRes 422"
    default: return code
    }
}

private func defaultTimes(duration: Double) -> [Double] {
    [0.08, 0.24, 0.40, 0.56, 0.72, 0.88].map { max(0, min(duration - 0.05, duration * $0)) }
}

private func makeContactSheet(
    frames: [(image: CGImage, requested: Double, actual: Double)],
    outputURL: URL,
    overwrite: Bool
) throws {
    let columns = 3
    let rows = Int(ceil(Double(frames.count) / Double(columns)))
    let canvasWidth = 1_920
    let margin: CGFloat = 90
    let gap: CGFloat = 30
    let tileWidth: CGFloat = 560
    let tileHeight: CGFloat = 315
    let labelHeight: CGFloat = 46
    let rowGap: CGFloat = 38
    let canvasHeight = Int(margin * 2 + CGFloat(rows) * (tileHeight + labelHeight) + CGFloat(max(0, rows - 1)) * rowGap)

    guard let representation = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: canvasWidth,
        pixelsHigh: canvasHeight,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [],
        bytesPerRow: canvasWidth * 4,
        bitsPerPixel: 32
    ), let context = NSGraphicsContext(bitmapImageRep: representation) else {
        try fail("Cannot allocate contact sheet")
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    NSColor(calibratedRed: 0.06, green: 0.11, blue: 0.14, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight).fill()

    for (index, frame) in frames.enumerated() {
        let column = index % columns
        let row = index / columns
        let x = margin + CGFloat(column) * (tileWidth + gap)
        let top = CGFloat(canvasHeight) - margin - CGFloat(row) * (tileHeight + labelHeight + rowGap)
        let imageY = top - tileHeight
        let frameRect = NSRect(x: x, y: imageY, width: tileWidth, height: tileHeight)
        NSColor(calibratedWhite: 1, alpha: 0.08).setFill()
        NSBezierPath(roundedRect: frameRect.insetBy(dx: -4, dy: -4), xRadius: 16, yRadius: 16).fill()
        context.cgContext.saveGState()
        NSBezierPath(roundedRect: frameRect, xRadius: 12, yRadius: 12).addClip()
        NSImage(cgImage: frame.image, size: NSSize(width: frame.image.width, height: frame.image.height)).draw(
            in: frameRect,
            from: .zero,
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: false,
            hints: [.interpolation: NSImageInterpolation.high.rawValue]
        )
        context.cgContext.restoreGState()

        let label = String(format: "%02d  requested %.3fs  actual %.3fs", index + 1, frame.requested, frame.actual)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 19, weight: .medium),
            .foregroundColor: NSColor(calibratedWhite: 0.88, alpha: 1),
        ]
        NSAttributedString(string: label, attributes: attributes).draw(in: NSRect(x: x, y: imageY - labelHeight + 8, width: tileWidth, height: 32))
    }
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    guard let png = representation.representation(using: .png, properties: [:]) else {
        try fail("Cannot encode contact sheet PNG")
    }
    if overwrite, FileManager.default.fileExists(atPath: outputURL.path) {
        try FileManager.default.removeItem(at: outputURL)
    }
    try png.write(to: outputURL, options: .atomic)
}

private func run() async throws -> Bool {
    let options = try parseCLI()
    guard FileManager.default.fileExists(atPath: options.inputURL.path) else {
        try fail("Input video does not exist: \(options.inputURL.path)")
    }
    try ensureOutput(options.reportURL, overwrite: options.overwrite)
    try ensureOutput(options.contactSheetURL, overwrite: options.overwrite)

    let asset = AVURLAsset(url: options.inputURL)
    let duration = CMTimeGetSeconds(try await asset.load(.duration))
    guard duration.isFinite, duration > 0 else { try fail("Video duration is invalid") }
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { try fail("Video has no video track") }

    let naturalSize = try await track.load(.naturalSize)
    let preferredTransform = try await track.load(.preferredTransform)
    let transformedSize = naturalSize.applying(preferredTransform)
    let width = Int(abs(transformedSize.width).rounded())
    let height = Int(abs(transformedSize.height).rounded())
    let nominalFrameRate = Double(try await track.load(.nominalFrameRate))
    let formatDescription = try await track.load(.formatDescriptions).first
    let codecFourCC = formatDescription.map { fourCC(CMFormatDescriptionGetMediaSubType($0)) } ?? "unknown"
    let codec = codecName(for: codecFourCC)

    let rawTimes = options.requestedTimes ?? defaultTimes(duration: duration)
    let times = rawTimes.map { max(0, min(duration - 0.001, $0)) }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 1_920, height: 1_080)
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
    generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)

    var frames: [(image: CGImage, requested: Double, actual: Double)] = []
    for seconds in times {
        let requested = CMTime(seconds: seconds, preferredTimescale: 600)
        let (image, actual) = try await generator.image(at: requested)
        frames.append((image, seconds, CMTimeGetSeconds(actual)))
    }
    try makeContactSheet(frames: frames, outputURL: options.contactSheetURL, overwrite: options.overwrite)

    let checks: [String: Bool] = [
        "codecIsH264": codec == "H.264",
        "durationIsPositive": duration > 0,
        "frameRateIs30": abs(nominalFrameRate - 30) < 0.05,
        "resolutionIs1920x1080": width == 1_920 && height == 1_080,
    ]
    let report: [String: Any] = [
        "input": options.inputURL.path,
        "durationSeconds": duration,
        "width": width,
        "height": height,
        "codec": codec,
        "codecFourCC": codecFourCC,
        "nominalFrameRate": nominalFrameRate,
        "estimatedFrameCount": Int((duration * nominalFrameRate).rounded()),
        "contactSheet": options.contactSheetURL.path,
        "frames": frames.enumerated().map { index, frame in
            ["index": index + 1, "requestedSeconds": frame.requested, "actualSeconds": frame.actual]
        },
        "checks": checks,
        "standardPassed": checks.values.allSatisfy { $0 },
    ]
    let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    if options.overwrite, FileManager.default.fileExists(atPath: options.reportURL.path) {
        try FileManager.default.removeItem(at: options.reportURL)
    }
    try data.write(to: options.reportURL, options: .atomic)
    print(String(decoding: data, as: UTF8.self))
    return checks.values.allSatisfy { $0 }
}

@main
private struct VerifyVideoMain {
    static func main() async {
        do {
            let passed = try await run()
            if !passed { exit(2) }
        } catch {
            fputs("verify-video: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}
