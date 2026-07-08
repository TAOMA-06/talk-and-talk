import SwiftUI

public struct ContentView: View {
    @EnvironmentObject private var store: AppStore
    
    public init() {}
    
    public var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("首页", systemImage: "house")
                }
            
            OrdersView()
                .tabItem {
                    Label("订单", systemImage: "calendar")
                }
            
            MessagesView()
                .tabItem {
                    Label("消息", systemImage: "message")
                }
            
            ProfileView()
                .tabItem {
                    Label("我的", systemImage: "person")
                }
        }
    }
}
