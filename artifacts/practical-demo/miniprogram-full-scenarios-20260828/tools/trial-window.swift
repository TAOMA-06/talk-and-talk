import AppKit
import Foundation

final class TrialView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedRed: 0.05, green: 0.11, blue: 0.14, alpha: 1).setFill()
        bounds.fill()
        let style = NSMutableParagraphStyle(); style.alignment = .center
        NSAttributedString(string: "SYNTHETIC CAPTURE PIPELINE TRIAL\n合成录屏短测 · NOT EVIDENCE", attributes: [
            .font: NSFont.systemFont(ofSize: 34, weight: .bold),
            .foregroundColor: NSColor.white,
            .paragraphStyle: style,
        ]).draw(in: NSRect(x: 30, y: 115, width: 580, height: 140))
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let screenHeight = NSScreen.main?.frame.height ?? 982
let window = NSWindow(contentRect: NSRect(x: 100, y: screenHeight - 100 - 360, width: 640, height: 360), styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = TrialView(frame: window.contentView!.bounds)
window.level = .normal
window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
DispatchQueue.main.asyncAfter(deadline: .now() + 12) { app.terminate(nil) }
app.run()
