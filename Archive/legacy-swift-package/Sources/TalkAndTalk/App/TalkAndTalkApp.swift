import SwiftUI

public struct TalkAndTalkAppRoot: View {
    @StateObject private var appStore = AppStore()
    
    public init() {}
    
    public var body: some View {
        ContentView()
            .environmentObject(appStore)
    }
}
