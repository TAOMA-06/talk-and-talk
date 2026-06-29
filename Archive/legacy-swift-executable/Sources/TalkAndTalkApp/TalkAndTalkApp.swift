import SwiftUI
import TalkAndTalk

@main
struct TalkAndTalkApp: App {
    @StateObject private var appStore = AppStore()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appStore)
        }
    }
}
