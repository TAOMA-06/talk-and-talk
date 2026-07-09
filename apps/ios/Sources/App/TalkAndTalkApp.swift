import SwiftUI

@main
struct TalkAndTalkApp: App {
    @StateObject private var authSession: AuthSession
    @StateObject private var appStore: AppStore

    init() {
        let tokenStore = KeychainTokenStore()
        let session = AuthSession(tokenStore: tokenStore)
        _authSession = StateObject(wrappedValue: session)
        _appStore = StateObject(wrappedValue: AppStore(
            authSession: session,
            backendClientFactory: { baseURL in
                BackendClient(
                    baseURL: baseURL,
                    tokenProvider: { tokenStore.getAccessToken() },
                    unauthorizedHandler: {
                        await session.refreshIfNeeded()
                        return tokenStore.getAccessToken() != nil
                    }
                )
            }
        ))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authSession)
                .environmentObject(appStore)
                .task {
                    await authSession.bootstrap()
                    if case .authenticated(let user) = authSession.state {
                        appStore.applyAuthenticatedUser(user)
                    }
                }
                .onChange(of: authSession.state) { _, newState in
                    if case .authenticated(let user) = newState {
                        appStore.applyAuthenticatedUser(user)
                    }
                }
        }
    }
}

private struct RootView: View {
    @EnvironmentObject private var authSession: AuthSession

    var body: some View {
        Group {
            switch authSession.state {
            case .loading:
                ProgressView("正在加载...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.dsBackground)
            case .unauthenticated:
                LoginView()
            case .authenticated:
                ContentView()
            }
        }
    }
}
