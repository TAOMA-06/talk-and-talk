import SwiftUI

struct OrderView: View {
    let companionId: String
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    
    @State private var selectedThemeId: String = ""
    @State private var selectedDuration: Double = 1.0
    @State private var agreedToRules = false
    
    var companion: Companion? {
        store.companion(by: companionId)
    }
    
    let durations = [0.5, 1.0, 1.5, 2.0, 3.0]
    
    var totalPrice: Int {
        guard let companion = companion else { return 0 }
        return Int(Double(companion.pricePerHour) * selectedDuration)
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let companion = companion {
                    CompanionInfoCard(companion: companion)
                    
                    ThemeSelectionSection(
                        themes: store.themes,
                        selectedThemeId: $selectedThemeId
                    )
                    
                    DurationSelectionSection(
                        durations: durations,
                        selectedDuration: $selectedDuration
                    )
                    
                    PriceSummaryCard(
                        pricePerHour: companion.pricePerHour,
                        duration: selectedDuration,
                        totalPrice: totalPrice
                    )
                    
                    SafetyRulesSection(agreedToRules: $agreedToRules)
                    
                    OrderSubmitButton(
                        isEnabled: agreedToRules,
                        action: {
                            if !store.user.isVerified {
                                store.navigationPath.append(NavigationDestination.verify)
                            } else {
                                let order = store.createOrder(
                                    companionId: companionId,
                                    themeId: selectedThemeId,
                                    duration: selectedDuration
                                )
                                store.navigationPath.append(NavigationDestination.chat(companionId))
                            }
                        }
                    )
                } else {
                    EmptyState
                }
            }
            .padding()
        }
        .navigationTitle("确认订单")
        .onAppear {
            if selectedThemeId.isEmpty {
                selectedThemeId = store.themes.first?.id ?? ""
            }
        }
    }
    
    private var EmptyState: some View {
        VStack(spacing: 16) {
            Text("陪伴者不存在")
                .foregroundStyle(.secondary)
            Button("返回首页") {
                dismiss()
            }
            .tint(.teal)
        }
        .padding(.top, 60)
    }
}

struct CompanionInfoCard: View {
    let companion: Companion
    
    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: companion.avatar)) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Circle()
                    .fill(Color.gray.opacity(0.3))
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            
            VStack(alignment: .leading, spacing: 4) {
                Text(companion.name)
                    .font(.headline)
                Text("¥\(companion.pricePerHour)/小时")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct ThemeSelectionSection: View {
    let themes: [Theme]
    @Binding var selectedThemeId: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("选择沟通主题")
                .font(.headline)
            
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 8) {
                ForEach(themes) { theme in
                    ThemeButton(theme: theme, isSelected: selectedThemeId == theme.id) {
                        selectedThemeId = theme.id
                    }
                }
            }
        }
    }
}

struct ThemeButton: View {
    let theme: Theme
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(theme.name)
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(isSelected ? BorderlessButtonStyle() : BorderlessButtonStyle())
        .tint(isSelected ? .teal : .primary)
    }
}

struct DurationSelectionSection: View {
    let durations: [Double]
    @Binding var selectedDuration: Double
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("选择时长")
                .font(.headline)
            
            HStack(spacing: 8) {
                ForEach(durations, id: \.self) { duration in
                    DurationButton(duration: duration, isSelected: selectedDuration == duration) {
                        selectedDuration = duration
                    }
                }
            }
        }
    }
}

struct DurationButton: View {
    let duration: Double
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(durationString)
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(isSelected ? BorderlessButtonStyle() : BorderlessButtonStyle())
        .tint(isSelected ? .teal : .primary)
    }
    
    private var durationString: String {
        String(format: "%.1fh", duration)
    }
}

struct PriceSummaryCard: View {
    let pricePerHour: Int
    let duration: Double
    let totalPrice: Int
    
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("单价")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("¥\(pricePerHour)/小时")
            }
            .font(.subheadline)
            
            HStack {
                Text("时长")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(duration, specifier: "%.1f") 小时")
            }
            .font(.subheadline)
            
            Divider()
            
            HStack {
                Text("合计")
                    .fontWeight(.medium)
                Spacer()
                Text("¥\(totalPrice)")
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundStyle(.orange)
            }
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct SafetyRulesSection: View {
    @Binding var agreedToRules: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "shield.checkered")
                    .foregroundStyle(.teal)
                Text("平台安全规范")
                    .font(.headline)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                RuleItem(text: "沟通内容受平台保护，严禁违法违规内容")
                RuleItem(text: "陪伴者仅提供情感支持与陪伴服务")
                RuleItem(text: "如遇不适可立即结束并举报")
                RuleItem(text: "未成年人禁止下单")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            
            Toggle("我已阅读并同意平台安全规范", isOn: $agreedToRules)
                .font(.subheadline)
        }
        .padding()
        .background(Color.teal.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.teal.opacity(0.2), lineWidth: 1)
        )
    }
}

struct RuleItem: View {
    let text: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•")
            Text(text)
        }
    }
}

struct OrderSubmitButton: View {
    let isEnabled: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text("确认下单")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        }
        .buttonStyle(.borderedProminent)
        .tint(.primary)
        .disabled(!isEnabled)
    }
}
