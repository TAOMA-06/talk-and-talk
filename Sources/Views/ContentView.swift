import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        TabView(selection: $store.selectedTab) {
            NavigationStack(path: $store.discoverPath) {
                HomeView().withRoutes()
            }
            .tabItem { Label(AppTab.discover.title, systemImage: AppTab.discover.symbol) }
            .tag(AppTab.discover)

            NavigationStack(path: $store.communityPath) {
                CommunityView().withRoutes()
            }
            .tabItem { Label(AppTab.community.title, systemImage: AppTab.community.symbol) }
            .tag(AppTab.community)

            NavigationStack(path: $store.ordersPath) {
                OrdersView().withRoutes()
            }
            .tabItem { Label(AppTab.orders.title, systemImage: AppTab.orders.symbol) }
            .tag(AppTab.orders)

            NavigationStack(path: $store.messagesPath) {
                MessagesView().withRoutes()
            }
            .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.symbol) }
            .tag(AppTab.messages)

            NavigationStack(path: $store.profilePath) {
                ProfileView().withRoutes()
            }
            .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.symbol) }
            .tag(AppTab.profile)
        }
        .tint(Color.dsPrimary)
        .background(Color.dsBackground)
        .sheet(item: $store.agreementPrompt) { prompt in
            UserAgreementSheet(prompt: prompt) {
                store.dismissAgreementPrompt()
            }
            .interactiveDismissDisabled(prompt.requiredReadSeconds > 0)
        }
    }
}

private extension View {
    func withRoutes() -> some View {
        navigationDestination(for: AppRoute.self) { route in
            switch route {
            case .companionList(let themeId, let preset):
                CompanionListView(themeId: themeId, preset: preset)
            case .companionDetail(let id):
                CompanionDetailView(companionId: id)
            case .order(let id):
                OrderView(companionId: id)
            case .chat(let id):
                ChatView(companionId: id)
            case .review(let id):
                ReviewView(companionId: id)
            case .verify:
                VerifyView()
            case .safetyCenter:
                SafetyCenterView()
            case .admin:
                AdminView()
            }
        }
    }
}
