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
        .task {
            await store.refreshBackendConnection()
        }
        .sheet(item: $store.agreementPrompt) { prompt in
            UserAgreementSheet(prompt: prompt) {
                store.dismissAgreementPrompt()
            }
            .interactiveDismissDisabled(prompt.requiredReadSeconds > 0)
        }
        .fullScreenCover(
            isPresented: Binding(
                get: { store.user.gender == nil },
                set: { _ in }
            )
        ) {
            InitialGenderSelectionView()
                .interactiveDismissDisabled()
        }
    }
}

struct InitialGenderSelectionView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                Spacer()
                StepTitle(symbol: "person.2", title: "选择你的身份", subtitle: "用于匹配广场展示规则：女生发需求，男生实名后发自荐。")
                HStack(spacing: DS.Space.sm) {
                    GenderChoiceButton(gender: .female, isSelected: false, symbol: "heart.text.square") {
                        store.setUserGender(.female)
                    }
                    GenderChoiceButton(gender: .male, isSelected: false, symbol: "checkmark.shield") {
                        store.setUserGender(.male)
                    }
                }
                Text("选择后可在“我的”里调整。")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
                Spacer()
            }
            .padding(DS.Space.lg)
        }
    }
}

struct GenderChoiceButton: View {
    let gender: UserGender
    var isSelected: Bool
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: DS.Space.sm) {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .semibold))
                Text(gender.displayName)
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(isSelected ? Color.dsSurface : Color.dsTextPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 104)
            .background(isSelected ? Color.dsPrimary : Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(isSelected ? Color.dsPrimary : Color.dsBorder, lineWidth: 1)
            }
        }
        .buttonStyle(DSPressButtonStyle())
        .accessibilityLabel("选择\(gender.displayName)身份")
        .accessibilityHint("用于匹配广场展示和发布规则，之后可在我的页面调整")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("gender-\(gender.rawValue)")
    }
}

private extension View {
    func withRoutes() -> some View {
        navigationDestination(for: AppRoute.self) { route in
            Group {
                switch route {
                case .companionList(let themeId, let preset):
                    CompanionListView(themeId: themeId, preset: preset)
                case .companionDetail(let id):
                    CompanionDetailView(companionId: id)
                case .companionHomepage(let id):
                    CompanionHomepageView(companionId: id)
                case .order(let id):
                    OrderView(companionId: id)
                case .chat(let target):
                    ChatView(target: target)
                case .review(let id):
                    ReviewView(companionId: id)
                case .verify:
                    VerifyView()
                case .safetyCenter:
                    SafetyCenterView()
#if DEBUG
                case .admin:
                    AdminView()
#endif
                }
            }
        }
    }
}
