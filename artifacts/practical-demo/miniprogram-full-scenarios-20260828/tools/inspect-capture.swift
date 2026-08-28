import CoreGraphics
import Foundation

struct Options {
    var ownerContains = "wechatwebdevtools"
    var requirePermission = false
    var requireWindowID: CGWindowID?
}

func parseOptions() throws -> Options {
    var options = Options()
    var index = 1
    while index < CommandLine.arguments.count {
        switch CommandLine.arguments[index] {
        case "--owner-contains":
            index += 1
            guard index < CommandLine.arguments.count else { throw NSError(domain: "inspect", code: 1) }
            options.ownerContains = CommandLine.arguments[index]
        case "--require-permission":
            options.requirePermission = true
        case "--require-window-id":
            index += 1
            guard index < CommandLine.arguments.count, let value = UInt32(CommandLine.arguments[index]) else {
                throw NSError(domain: "inspect", code: 2)
            }
            options.requireWindowID = value
        case "--help", "-h":
            print("Usage: inspect-capture [--owner-contains name] [--require-permission] [--require-window-id id]")
            exit(0)
        default:
            throw NSError(domain: "inspect", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unknown argument \(CommandLine.arguments[index])"])
        }
        index += 1
    }
    return options
}

do {
    let options = try parseOptions()
    let permission = CGPreflightScreenCaptureAccess()
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    var displayIDs = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &displayIDs, &count)
    let displays: [[String: Any]] = displayIDs.map { id in
        let bounds = CGDisplayBounds(id)
        return [
            "id": id,
            "main": id == CGMainDisplayID(),
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.width,
            "height": bounds.height,
            "pixelsWide": CGDisplayPixelsWide(id),
            "pixelsHigh": CGDisplayPixelsHigh(id),
        ]
    }
    let rawWindows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    let needle = options.ownerContains.lowercased()
    let aliases = [needle, "微信开发者工具", "wechat developer tools", "webplusdevtools"]
    let windows: [[String: Any]] = rawWindows.compactMap { item in
        let owner = item[kCGWindowOwnerName as String] as? String ?? ""
        let name = item[kCGWindowName as String] as? String ?? ""
        let haystack = (owner + " " + name).lowercased()
        guard aliases.contains(where: { !$0.isEmpty && haystack.contains($0) }) else { return nil }
        let bounds = item[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let width = bounds["Width"] as? Double ?? 0
        let height = bounds["Height"] as? Double ?? 0
        let layer = item[kCGWindowLayer as String] as? Int ?? -1
        let alpha = item[kCGWindowAlpha as String] as? Double ?? 0
        let eligible = layer == 0 && alpha > 0 && width >= 300 && height >= 300
        return [
            "windowId": item[kCGWindowNumber as String] ?? 0,
            "owner": owner,
            "name": name,
            "layer": layer,
            "alpha": alpha,
            "bounds": bounds,
            "eligible": eligible,
        ]
    }
    let result: [String: Any] = [
        "screenCapturePermission": permission,
        "displays": displays,
        "matchingWindows": windows,
        "recommendedWindow": windows.filter { ($0["eligible"] as? Bool) == true }.max {
            let lhs = ($0["bounds"] as? [String: Any]) ?? [:]
            let rhs = ($1["bounds"] as? [String: Any]) ?? [:]
            return (lhs["Width"] as? Double ?? 0) * (lhs["Height"] as? Double ?? 0) < (rhs["Width"] as? Double ?? 0) * (rhs["Height"] as? Double ?? 0)
        } ?? NSNull(),
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    if options.requirePermission && !permission { exit(2) }
    if let required = options.requireWindowID {
        let matched = windows.contains { ($0["windowId"] as? UInt32) == required && ($0["eligible"] as? Bool) == true }
        if !matched { exit(3) }
    }
} catch {
    fputs("inspect-capture: \(error.localizedDescription)\n", stderr)
    exit(1)
}
