#!/usr/bin/env swift

import AppKit
import AVFoundation
import CoreVideo
import Foundation
import ImageIO

private let outputWidth = 1_920
private let outputHeight = 1_080

private enum RenderError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case let .message(message): return message
        }
    }
}

private struct Manifest: Decodable {
    let schemaVersion: Int
    let video: VideoSpec
    let timing: TimingSpec
    let cards: CardSpec
    let shots: [ShotSpec]
    let footer: String
}

private struct VideoSpec: Decodable {
    let width: Int
    let height: Int
    let fps: Int
    let codec: String
    let averageBitRate: Int
}

private struct TimingSpec: Decodable {
    let titleSeconds: Double
    let boundarySeconds: Double
    let resultSeconds: Double
    let crossfadeSeconds: Double
}

private struct CardSpec: Decodable {
    let title: TitleCard
    let boundary: BoundaryCard
    let result: ResultCard
}

private struct TitleCard: Decodable {
    let kicker: String
    let title: String
    let subtitle: String
    let meta: [String]
}

private struct BoundaryCard: Decodable {
    let title: String
    let subtitle: String
    let items: [String]
}

private enum ResultStatus: String, Decodable {
    case passed
    case failed
    case blocked
    case notRun = "not_run"

    var label: String {
        switch self {
        case .passed: return "通过"
        case .failed: return "未通过"
        case .blocked: return "阻断"
        case .notRun: return "未执行"
        }
    }

    var color: NSColor {
        switch self {
        case .passed: return NSColor(calibratedRed: 0.12, green: 0.53, blue: 0.39, alpha: 1)
        case .failed: return NSColor(calibratedRed: 0.78, green: 0.23, blue: 0.20, alpha: 1)
        case .blocked: return NSColor(calibratedRed: 0.84, green: 0.49, blue: 0.12, alpha: 1)
        case .notRun: return NSColor(calibratedWhite: 0.43, alpha: 1)
        }
    }
}

private struct ResultCard: Decodable {
    let status: ResultStatus
    let headline: String
    let details: [String]
    let evidenceRefs: [String]
}

private enum SourceKind: String, Decodable {
    case evidence
    case syntheticPlaceholder = "synthetic-placeholder"
}

private enum ImageFit: String, Decodable {
    case contain
    case cover
}

private enum Motion: String, Decodable {
    case none
    case zoomIn
    case zoomOut
    case panLeft
    case panRight
}

private struct ShotSpec: Decodable {
    let id: String
    let image: String
    let sourceKind: SourceKind
    let evidenceRef: String
    let label: String
    let caption: String
    let durationSeconds: Double
    let fit: ImageFit
    let motion: Motion
}

private struct LoadedShot {
    let spec: ShotSpec
    let image: NSImage
}

private enum SceneKind {
    case title
    case boundary
    case shot(Int)
    case result
}

private struct Scene {
    let kind: SceneKind
    let durationFrames: Int
}

private struct CLIOptions {
    let manifestURL: URL
    let outputURL: URL
    let allowSynthetic: Bool
    let overwrite: Bool
}

private func fail(_ message: String) throws -> Never {
    throw RenderError.message(message)
}

private func requireAbsoluteURL(_ path: String, label: String) throws -> URL {
    guard path.hasPrefix("/") else {
        try fail("\(label) must be an absolute path: \(path)")
    }
    return URL(fileURLWithPath: path).standardizedFileURL
}

private func parseCLI() throws -> CLIOptions {
    var manifestPath: String?
    var outputPath: String?
    var allowSynthetic = false
    var overwrite = false
    var index = 1
    let arguments = CommandLine.arguments

    while index < arguments.count {
        switch arguments[index] {
        case "--manifest":
            index += 1
            guard index < arguments.count else { try fail("--manifest requires a path") }
            manifestPath = arguments[index]
        case "--output":
            index += 1
            guard index < arguments.count else { try fail("--output requires a path") }
            outputPath = arguments[index]
        case "--allow-synthetic":
            allowSynthetic = true
        case "--overwrite":
            overwrite = true
        case "--help", "-h":
            print("Usage: render-demo --manifest /absolute/manifest.json --output /absolute/video.mp4 [--allow-synthetic] [--overwrite]")
            exit(0)
        default:
            try fail("Unknown argument: \(arguments[index])")
        }
        index += 1
    }

    guard let manifestPath else { try fail("Missing --manifest") }
    guard let outputPath else { try fail("Missing --output") }
    let manifestURL = try requireAbsoluteURL(manifestPath, label: "Manifest")
    let outputURL = try requireAbsoluteURL(outputPath, label: "Output")
    guard outputURL.pathExtension.lowercased() == "mp4" else {
        try fail("Output must use the .mp4 extension")
    }
    return CLIOptions(
        manifestURL: manifestURL,
        outputURL: outputURL,
        allowSynthetic: allowSynthetic,
        overwrite: overwrite
    )
}

private func loadManifest(at url: URL) throws -> Manifest {
    guard FileManager.default.fileExists(atPath: url.path) else {
        try fail("Manifest does not exist: \(url.path)")
    }
    do {
        return try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
    } catch {
        try fail("Cannot decode manifest: \(error.localizedDescription)")
    }
}

private func validate(_ manifest: Manifest, options: CLIOptions) throws {
    guard manifest.schemaVersion == 1 else { try fail("schemaVersion must be 1") }
    guard manifest.video.width == outputWidth,
          manifest.video.height == outputHeight,
          manifest.video.fps == 30,
          manifest.video.codec.lowercased() == "h264" else {
        try fail("Video must be exactly 1920x1080, 30 fps, H.264")
    }
    guard (4_000_000...30_000_000).contains(manifest.video.averageBitRate) else {
        try fail("averageBitRate must be between 4,000,000 and 30,000,000")
    }
    let timingValues = [
        manifest.timing.titleSeconds,
        manifest.timing.boundarySeconds,
        manifest.timing.resultSeconds,
    ]
    guard timingValues.allSatisfy({ $0 >= 1 && $0 <= 30 }) else {
        try fail("Card durations must be between 1 and 30 seconds")
    }
    guard manifest.timing.crossfadeSeconds >= 0,
          manifest.timing.crossfadeSeconds <= 1.5,
          timingValues.allSatisfy({ $0 > manifest.timing.crossfadeSeconds }) else {
        try fail("crossfadeSeconds must be 0...1.5 and shorter than every card")
    }
    guard !manifest.cards.title.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        try fail("Title card title must not be empty")
    }
    guard !manifest.cards.boundary.items.isEmpty else {
        try fail("Boundary card must contain at least one explicit item")
    }
    guard !manifest.cards.result.headline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !manifest.cards.result.details.isEmpty,
          !manifest.cards.result.evidenceRefs.isEmpty else {
        try fail("Result card requires an explicit headline, details, and evidenceRefs")
    }
    guard !manifest.shots.isEmpty else { try fail("Manifest must contain at least one shot") }

    var identifiers = Set<String>()
    for shot in manifest.shots {
        guard identifiers.insert(shot.id).inserted else { try fail("Duplicate shot id: \(shot.id)") }
        guard shot.durationSeconds >= 1,
              shot.durationSeconds <= 30,
              shot.durationSeconds > manifest.timing.crossfadeSeconds else {
            try fail("Shot \(shot.id) duration must be 1...30 seconds and longer than the crossfade")
        }
        guard !shot.evidenceRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            try fail("Shot \(shot.id) requires evidenceRef")
        }
        let imageURL = try requireAbsoluteURL(shot.image, label: "Shot \(shot.id) image")
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: imageURL.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            try fail("Shot image does not exist or is not a file: \(imageURL.path)")
        }
        if shot.sourceKind == .syntheticPlaceholder {
            guard options.allowSynthetic else {
                try fail("Synthetic shot \(shot.id) requires explicit --allow-synthetic")
            }
            // Foundation canonicalizes /private/tmp to /tmp on macOS. Check the
            // manifest spelling so synthetic fixtures stay explicitly scoped.
            guard shot.image.hasPrefix("/private/tmp/") else {
                try fail("Synthetic shot \(shot.id) must live under /private/tmp")
            }
        }
        if imageURL == options.outputURL {
            try fail("Output must never replace an input image")
        }
    }

    let parentURL = options.outputURL.deletingLastPathComponent()
    var parentIsDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: parentURL.path, isDirectory: &parentIsDirectory), parentIsDirectory.boolValue else {
        try fail("Output parent directory must already exist: \(parentURL.path)")
    }
    if FileManager.default.fileExists(atPath: options.outputURL.path), !options.overwrite {
        try fail("Output exists; pass --overwrite explicitly to replace it")
    }
}

private func loadCGImage(at url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        try fail("Cannot decode image: \(url.path)")
    }
    return image
}

private func loadShots(_ manifest: Manifest) throws -> [LoadedShot] {
    try manifest.shots.map { spec in
        let url = try requireAbsoluteURL(spec.image, label: "Shot \(spec.id) image")
        let cgImage = try loadCGImage(at: url)
        let size = NSSize(width: cgImage.width, height: cgImage.height)
        return LoadedShot(spec: spec, image: NSImage(cgImage: cgImage, size: size))
    }
}

private func color(hex: String, alpha: CGFloat = 1) -> NSColor {
    let normalized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard normalized.count == 6, let value = Int(normalized, radix: 16) else {
        return NSColor(calibratedWhite: 0.2, alpha: alpha)
    }
    return NSColor(
        calibratedRed: CGFloat((value >> 16) & 0xff) / 255,
        green: CGFloat((value >> 8) & 0xff) / 255,
        blue: CGFloat(value & 0xff) / 255,
        alpha: alpha
    )
}

private func paragraphStyle(alignment: NSTextAlignment = .left, lineHeight: CGFloat? = nil) -> NSMutableParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    style.lineBreakMode = .byWordWrapping
    if let lineHeight {
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
    }
    return style
}

private func drawText(
    _ value: String,
    in rect: NSRect,
    font: NSFont,
    textColor: NSColor,
    alignment: NSTextAlignment = .left,
    lineHeight: CGFloat? = nil
) {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraphStyle(alignment: alignment, lineHeight: lineHeight),
    ]
    NSAttributedString(string: value, attributes: attributes).draw(
        with: rect,
        options: [.usesLineFragmentOrigin, .usesFontLeading]
    )
}

private func drawPill(_ text: String, color fill: NSColor, rect: NSRect) {
    fill.setFill()
    NSBezierPath(roundedRect: rect, xRadius: rect.height / 2, yRadius: rect.height / 2).fill()
    drawText(
        text,
        in: rect.insetBy(dx: 22, dy: 13),
        font: .systemFont(ofSize: 25, weight: .semibold),
        textColor: .white,
        alignment: .center
    )
}

private func bitmapImage(draw: () -> Void) throws -> NSImage {
    guard let representation = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: outputWidth,
        pixelsHigh: outputHeight,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [.alphaFirst],
        bytesPerRow: outputWidth * 4,
        bitsPerPixel: 32
    ), let context = NSGraphicsContext(bitmapImageRep: representation) else {
        try fail("Cannot create card bitmap")
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    draw()
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    guard let cgImage = representation.cgImage else { try fail("Cannot finalize card bitmap") }
    return NSImage(cgImage: cgImage, size: NSSize(width: outputWidth, height: outputHeight))
}

private func makeTitleCard(_ card: TitleCard, footer: String) throws -> NSImage {
    try bitmapImage {
        let canvas = NSRect(x: 0, y: 0, width: outputWidth, height: outputHeight)
        NSGradient(colors: [color(hex: "F7F2EA"), color(hex: "E7F0EC")])?.draw(in: canvas, angle: 12)

        color(hex: "C85C45", alpha: 0.12).setFill()
        NSBezierPath(ovalIn: NSRect(x: 1_410, y: 610, width: 520, height: 520)).fill()
        color(hex: "285C56", alpha: 0.10).setFill()
        NSBezierPath(ovalIn: NSRect(x: -120, y: -150, width: 560, height: 560)).fill()

        drawPill(card.kicker, color: color(hex: "285C56"), rect: NSRect(x: 150, y: 850, width: 440, height: 70))
        drawText(
            card.title,
            in: NSRect(x: 150, y: 535, width: 1_500, height: 250),
            font: .systemFont(ofSize: 86, weight: .bold),
            textColor: color(hex: "17252E"),
            lineHeight: 102
        )
        drawText(
            card.subtitle,
            in: NSRect(x: 155, y: 405, width: 1_400, height: 100),
            font: .systemFont(ofSize: 34, weight: .regular),
            textColor: color(hex: "42545B"),
            lineHeight: 48
        )

        var metaX: CGFloat = 155
        var metaY: CGFloat = 285
        for item in card.meta {
            let width = min(520, max(210, CGFloat(item.count) * 24 + 70))
            if metaX + width > 1_765 {
                metaX = 155
                metaY -= 82
            }
            color(hex: "FFFFFF", alpha: 0.78).setFill()
            let rect = NSRect(x: metaX, y: metaY, width: width, height: 66)
            NSBezierPath(roundedRect: rect, xRadius: 18, yRadius: 18).fill()
            drawText(item, in: rect.insetBy(dx: 20, dy: 15), font: .systemFont(ofSize: 25, weight: .medium), textColor: color(hex: "284044"))
            metaX += width + 18
        }
        drawText(footer, in: NSRect(x: 155, y: 92, width: 1_610, height: 40), font: .systemFont(ofSize: 22, weight: .regular), textColor: color(hex: "5B6D70"))
    }
}

private func makeBoundaryCard(_ card: BoundaryCard, footer: String) throws -> NSImage {
    try bitmapImage {
        color(hex: "15262E").setFill()
        NSRect(x: 0, y: 0, width: outputWidth, height: outputHeight).fill()
        drawPill("证据边界", color: color(hex: "C85C45"), rect: NSRect(x: 150, y: 866, width: 260, height: 66))
        drawText(card.title, in: NSRect(x: 150, y: 710, width: 1_580, height: 120), font: .systemFont(ofSize: 62, weight: .bold), textColor: .white, lineHeight: 76)
        drawText(card.subtitle, in: NSRect(x: 155, y: 620, width: 1_550, height: 70), font: .systemFont(ofSize: 29, weight: .regular), textColor: color(hex: "B8CACD"), lineHeight: 42)

        let columns = card.items.count > 3 ? 2 : 1
        let rows = Int(ceil(Double(card.items.count) / Double(columns)))
        let columnWidth: CGFloat = columns == 2 ? 770 : 1_570
        for (index, item) in card.items.enumerated() {
            let column = index / rows
            let row = index % rows
            let x = 150 + CGFloat(column) * 820
            let y = 500 - CGFloat(row) * 132
            color(hex: "FFFFFF", alpha: 0.07).setFill()
            let rect = NSRect(x: x, y: y, width: columnWidth, height: 102)
            NSBezierPath(roundedRect: rect, xRadius: 22, yRadius: 22).fill()
            color(hex: "75B5A8").setFill()
            NSBezierPath(ovalIn: NSRect(x: x + 25, y: y + 38, width: 26, height: 26)).fill()
            drawText(item, in: NSRect(x: x + 72, y: y + 25, width: columnWidth - 95, height: 62), font: .systemFont(ofSize: 27, weight: .medium), textColor: .white, lineHeight: 34)
        }
        drawText(footer, in: NSRect(x: 155, y: 82, width: 1_610, height: 40), font: .systemFont(ofSize: 22), textColor: color(hex: "88A1A5"))
    }
}

private func makeResultCard(_ card: ResultCard, footer: String) throws -> NSImage {
    try bitmapImage {
        let canvas = NSRect(x: 0, y: 0, width: outputWidth, height: outputHeight)
        NSGradient(colors: [color(hex: "F5F1E9"), color(hex: "EEF2EF")])?.draw(in: canvas, angle: 0)
        drawPill("测试结果 · \(card.status.label)", color: card.status.color, rect: NSRect(x: 150, y: 858, width: 360, height: 72))
        drawText(card.headline, in: NSRect(x: 150, y: 655, width: 1_600, height: 150), font: .systemFont(ofSize: 66, weight: .bold), textColor: color(hex: "17252E"), lineHeight: 80)

        for (index, detail) in card.details.prefix(6).enumerated() {
            let column = index % 2
            let row = index / 2
            let x = 150 + CGFloat(column) * 820
            let y = 505 - CGFloat(row) * 128
            color(hex: "FFFFFF", alpha: 0.82).setFill()
            let rect = NSRect(x: x, y: y, width: 770, height: 100)
            NSBezierPath(roundedRect: rect, xRadius: 20, yRadius: 20).fill()
            card.status.color.setFill()
            NSBezierPath(ovalIn: NSRect(x: x + 24, y: y + 38, width: 24, height: 24)).fill()
            drawText(detail, in: NSRect(x: x + 68, y: y + 24, width: 670, height: 58), font: .systemFont(ofSize: 26, weight: .medium), textColor: color(hex: "2B4047"), lineHeight: 33)
        }

        let refs = "证据引用：" + card.evidenceRefs.joined(separator: "  ·  ")
        drawText(refs, in: NSRect(x: 155, y: 145, width: 1_610, height: 70), font: .systemFont(ofSize: 22, weight: .regular), textColor: color(hex: "53666B"), lineHeight: 30)
        drawText(footer, in: NSRect(x: 155, y: 82, width: 1_610, height: 40), font: .systemFont(ofSize: 22), textColor: color(hex: "6B7B7E"))
    }
}

private func baseImageRect(imageSize: NSSize, fit: ImageFit) -> NSRect {
    let canvasSize = NSSize(width: outputWidth, height: outputHeight)
    let scaleX = canvasSize.width / imageSize.width
    let scaleY = canvasSize.height / imageSize.height
    let scale = fit == .cover ? max(scaleX, scaleY) : min(scaleX, scaleY)
    let size = NSSize(width: imageSize.width * scale, height: imageSize.height * scale)
    return NSRect(
        x: (canvasSize.width - size.width) / 2,
        y: (canvasSize.height - size.height) / 2,
        width: size.width,
        height: size.height
    )
}

private func motionRect(base: NSRect, motion: Motion, progress: CGFloat) -> NSRect {
    let clamped = min(1, max(0, progress))
    var scale: CGFloat = 1
    var xShift: CGFloat = 0
    switch motion {
    case .none:
        break
    case .zoomIn:
        scale = 1 + 0.035 * clamped
    case .zoomOut:
        scale = 1.035 - 0.035 * clamped
    case .panLeft:
        scale = 1.045
        xShift = CGFloat(outputWidth) * (0.014 - 0.028 * clamped)
    case .panRight:
        scale = 1.045
        xShift = CGFloat(outputWidth) * (-0.014 + 0.028 * clamped)
    }
    let width = base.width * scale
    let height = base.height * scale
    return NSRect(
        x: base.midX - width / 2 + xShift,
        y: base.midY - height / 2,
        width: width,
        height: height
    )
}

private func drawShot(_ shot: LoadedShot, progress: CGFloat, alpha: CGFloat) {
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: outputWidth, height: outputHeight)).addClip()
    color(hex: "102129", alpha: alpha).setFill()
    NSRect(x: 0, y: 0, width: outputWidth, height: outputHeight).fill()

    let rect = motionRect(base: baseImageRect(imageSize: shot.image.size, fit: shot.spec.fit), motion: shot.spec.motion, progress: progress)
    shot.image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: alpha, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high.rawValue])

    if alpha > 0.02 {
        let overlayAlpha = alpha * 0.88
        color(hex: "102129", alpha: overlayAlpha).setFill()
        let labelRect = NSRect(x: 76, y: 938, width: min(680, max(270, CGFloat(shot.spec.label.count) * 27 + 90)), height: 72)
        NSBezierPath(roundedRect: labelRect, xRadius: 20, yRadius: 20).fill()
        drawText(shot.spec.label, in: labelRect.insetBy(dx: 24, dy: 17), font: .systemFont(ofSize: 27, weight: .semibold), textColor: NSColor.white.withAlphaComponent(alpha))

        color(hex: "102129", alpha: overlayAlpha).setFill()
        let captionRect = NSRect(x: 76, y: 54, width: 1_768, height: 112)
        NSBezierPath(roundedRect: captionRect, xRadius: 22, yRadius: 22).fill()
        drawText(shot.spec.caption, in: captionRect.insetBy(dx: 30, dy: 24), font: .systemFont(ofSize: 30, weight: .medium), textColor: NSColor.white.withAlphaComponent(alpha), lineHeight: 39)
        drawText(shot.spec.evidenceRef, in: NSRect(x: 1_300, y: 956, width: 540, height: 36), font: .monospacedSystemFont(ofSize: 18, weight: .regular), textColor: NSColor.white.withAlphaComponent(alpha * 0.78), alignment: .right)
    }
    NSGraphicsContext.restoreGraphicsState()
}

private func drawScene(
    _ scene: Scene,
    progress: CGFloat,
    alpha: CGFloat,
    titleImage: NSImage,
    boundaryImage: NSImage,
    resultImage: NSImage,
    shots: [LoadedShot]
) {
    let rect = NSRect(x: 0, y: 0, width: outputWidth, height: outputHeight)
    switch scene.kind {
    case .title:
        titleImage.draw(in: rect, from: .zero, operation: .sourceOver, fraction: alpha)
    case .boundary:
        boundaryImage.draw(in: rect, from: .zero, operation: .sourceOver, fraction: alpha)
    case let .shot(index):
        drawShot(shots[index], progress: progress, alpha: alpha)
    case .result:
        resultImage.draw(in: rect, from: .zero, operation: .sourceOver, fraction: alpha)
    }
}

private func createPixelBuffer(width: Int, height: Int, pool: CVPixelBufferPool?, draw: () -> Void) throws -> CVPixelBuffer {
    var optionalBuffer: CVPixelBuffer?
    let status: CVReturn
    if let pool {
        status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &optionalBuffer)
    } else {
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true,
        ]
        status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attributes as CFDictionary, &optionalBuffer)
    }
    guard status == kCVReturnSuccess, let buffer = optionalBuffer else {
        try fail("Cannot allocate pixel buffer (CVReturn \(status))")
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let baseAddress = CVPixelBufferGetBaseAddress(buffer) else { try fail("Pixel buffer has no base address") }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
    guard let cgContext = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: bitmapInfo
    ) else {
        try fail("Cannot create frame graphics context")
    }
    let graphicsContext = NSGraphicsContext(cgContext: cgContext, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphicsContext
    graphicsContext.imageInterpolation = .high
    color(hex: "0D1B22").setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    draw()
    graphicsContext.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    return buffer
}

private func waitUntilReady(_ input: AVAssetWriterInput, writer: AVAssetWriter) throws {
    while !input.isReadyForMoreMediaData {
        if writer.status == .failed {
            try fail("Video writer failed: \(writer.error?.localizedDescription ?? "unknown error")")
        }
        Thread.sleep(forTimeInterval: 0.002)
    }
}

private func render(manifest: Manifest, shots: [LoadedShot], outputURL: URL, overwrite: Bool) throws -> (frames: Int, duration: Double) {
    if overwrite, FileManager.default.fileExists(atPath: outputURL.path) {
        try FileManager.default.removeItem(at: outputURL)
    }

    let titleImage = try makeTitleCard(manifest.cards.title, footer: manifest.footer)
    let boundaryImage = try makeBoundaryCard(manifest.cards.boundary, footer: manifest.footer)
    let resultImage = try makeResultCard(manifest.cards.result, footer: manifest.footer)
    let fps = manifest.video.fps
    func frames(_ seconds: Double) -> Int { max(1, Int((seconds * Double(fps)).rounded())) }

    var scenes = [
        Scene(kind: .title, durationFrames: frames(manifest.timing.titleSeconds)),
        Scene(kind: .boundary, durationFrames: frames(manifest.timing.boundarySeconds)),
    ]
    scenes.append(contentsOf: shots.indices.map { Scene(kind: .shot($0), durationFrames: frames(shots[$0].spec.durationSeconds)) })
    scenes.append(Scene(kind: .result, durationFrames: frames(manifest.timing.resultSeconds)))

    let crossfadeFrames = max(0, Int((manifest.timing.crossfadeSeconds * Double(fps)).rounded()))
    var starts = [0]
    for index in 1..<scenes.count {
        starts.append(starts[index - 1] + scenes[index - 1].durationFrames - crossfadeFrames)
    }
    let totalFrames = starts.last! + scenes.last!.durationFrames

    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let compression: [String: Any] = [
        AVVideoAverageBitRateKey: manifest.video.averageBitRate,
        AVVideoExpectedSourceFrameRateKey: fps,
        AVVideoMaxKeyFrameIntervalKey: fps * 2,
        AVVideoAllowFrameReorderingKey: false,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ]
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: outputWidth,
        AVVideoHeightKey: outputHeight,
        AVVideoCompressionPropertiesKey: compression,
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let attributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: outputWidth,
        kCVPixelBufferHeightKey as String: outputHeight,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
    guard writer.canAdd(input) else { try fail("Cannot add H.264 video input") }
    writer.add(input)
    guard writer.startWriting() else {
        try fail("Cannot start video writer: \(writer.error?.localizedDescription ?? "unknown error")")
    }
    writer.startSession(atSourceTime: .zero)

    for frameIndex in 0..<totalFrames {
        try autoreleasepool {
            var currentSceneIndex = 0
            for index in starts.indices where starts[index] <= frameIndex {
                currentSceneIndex = index
            }
            let currentScene = scenes[currentSceneIndex]
            let currentLocalFrame = frameIndex - starts[currentSceneIndex]
            let currentProgress = CGFloat(currentLocalFrame) / CGFloat(max(1, currentScene.durationFrames - 1))

            let buffer = try createPixelBuffer(width: outputWidth, height: outputHeight, pool: adaptor.pixelBufferPool) {
                let inIncomingCrossfade = currentSceneIndex > 0 && currentLocalFrame < crossfadeFrames
                if inIncomingCrossfade {
                    let previousIndex = currentSceneIndex - 1
                    let previous = scenes[previousIndex]
                    let previousLocalFrame = frameIndex - starts[previousIndex]
                    let previousProgress = CGFloat(previousLocalFrame) / CGFloat(max(1, previous.durationFrames - 1))
                    drawScene(previous, progress: previousProgress, alpha: 1, titleImage: titleImage, boundaryImage: boundaryImage, resultImage: resultImage, shots: shots)
                    let blend = CGFloat(currentLocalFrame) / CGFloat(max(1, crossfadeFrames - 1))
                    drawScene(currentScene, progress: currentProgress, alpha: blend, titleImage: titleImage, boundaryImage: boundaryImage, resultImage: resultImage, shots: shots)
                } else {
                    drawScene(currentScene, progress: currentProgress, alpha: 1, titleImage: titleImage, boundaryImage: boundaryImage, resultImage: resultImage, shots: shots)
                }
            }
            try waitUntilReady(input, writer: writer)
            let presentationTime = CMTime(value: CMTimeValue(frameIndex), timescale: CMTimeScale(fps))
            guard adaptor.append(buffer, withPresentationTime: presentationTime) else {
                try fail("Cannot append frame \(frameIndex): \(writer.error?.localizedDescription ?? "unknown error")")
            }
        }
    }

    input.markAsFinished()
    let completion = DispatchSemaphore(value: 0)
    writer.finishWriting { completion.signal() }
    completion.wait()
    guard writer.status == .completed else {
        try fail("Video writer did not complete: \(writer.error?.localizedDescription ?? "status \(writer.status.rawValue)")")
    }
    return (totalFrames, Double(totalFrames) / Double(fps))
}

private func run() throws {
    let options = try parseCLI()
    let manifest = try loadManifest(at: options.manifestURL)
    try validate(manifest, options: options)
    let shots = try loadShots(manifest)
    let result = try render(manifest: manifest, shots: shots, outputURL: options.outputURL, overwrite: options.overwrite)
    let summary: [String: Any] = [
        "output": options.outputURL.path,
        "width": outputWidth,
        "height": outputHeight,
        "fps": manifest.video.fps,
        "codec": "H.264",
        "frames": result.frames,
        "durationSeconds": result.duration,
        "resultStatusFromManifest": manifest.cards.result.status.rawValue,
        "syntheticInputAllowed": options.allowSynthetic,
    ]
    let data = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}

do {
    try run()
} catch {
    fputs("render-demo: \(error.localizedDescription)\n", stderr)
    exit(1)
}
