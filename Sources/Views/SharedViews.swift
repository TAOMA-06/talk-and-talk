import SwiftUI

struct AppBackground: View {
    var body: some View {
        Color.dsBackground.ignoresSafeArea()
    }
}

struct AppScaffold<Content: View>: View {
    let title: String
    var spacing: CGFloat = DS.Space.lg
    var horizontalPadding: CGFloat = DS.Space.lg
    var topPadding: CGFloat = DS.Space.md
    var bottomPadding: CGFloat = 96
    var showsIndicators = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(showsIndicators: showsIndicators) {
            VStack(alignment: .leading, spacing: spacing) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, horizontalPadding)
            .padding(.top, topPadding)
            .padding(.bottom, bottomPadding)
        }
        .background(Color.dsBackground)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }
}

struct DSCardAlias<Content: View>: View {
    var padding: CGFloat = DS.Space.lg
    @ViewBuilder var content: Content

    var body: some View {
        DSCard(padding: padding) { content }
    }
}

typealias SoftCard = DSCardAlias
typealias GlassSurface = DSCardAlias
typealias GlassPanel = DSCardAlias

struct GlassCapsule<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(.horizontal, DS.Space.md)
            .padding(.vertical, DS.Space.sm)
            .background(Color.dsSurface, in: Capsule())
            .overlay(Capsule().stroke(Color.dsBorder, lineWidth: 1))
    }
}

struct PrimaryActionButton: View {
    let title: String
    let systemImage: String
    var isEnabled = true
    var action: () -> Void

    var body: some View {
        DSPrimaryButton(title: title, systemImage: systemImage, isEnabled: isEnabled, action: action)
    }
}

struct ModernHero: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let primaryTitle: String
    let primarySystemImage: String
    var secondary: String?
    var metricTitle: String = "可约"
    var metricValue: String = "0"
    let action: () -> Void

    var body: some View {
        DSCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        DSBadge(text: eyebrow, tone: .primary)
                        Text(title)
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: DS.Space.md)
                    VStack(spacing: DS.Space.xxs) {
                        Text(metricValue)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Color.dsTextPrimary)
                        Text(metricTitle)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    .padding(DS.Space.md)
                    .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
                }

                Text(subtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.dsTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                DSPrimaryButton(title: primaryTitle, systemImage: primarySystemImage, action: action)

                if let secondary {
                    Text(secondary)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                }
            }
        }
    }
}

struct ActionDock<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(DS.Space.lg)
            .background(Color.dsSurface)
            .overlay(alignment: .top) { Divider() }
            .padding(.horizontal, DS.Space.lg)
    }
}

struct CompanionAvatar: View {
    let companion: Companion
    var size: CGFloat = 48

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                .fill(Color.dsPrimary.opacity(0.12))
            Text(companion.initials)
                .font(.system(size: size * 0.34, weight: .semibold))
                .foregroundStyle(Color.dsPrimary)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            Circle()
                .fill(companion.availabilityColor)
                .frame(width: size * 0.22, height: size * 0.22)
                .overlay(Circle().stroke(Color.dsSurface, lineWidth: 2))
        }
        .accessibilityLabel("\(companion.name)头像")
    }
}

struct StatusPill: View {
    let text: String
    let symbol: String
    var color: Color = Color.dsPrimary

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .background(color.opacity(0.12), in: Capsule())
    }
}

struct AvailabilityBadge: View {
    let status: AvailabilityStatus

    var body: some View {
        DSBadge(text: status.displayName, tone: tone)
    }

    private var tone: DSBadge.Tone {
        switch status {
        case .online: .primary
        case .available: .success
        case .busy: .neutral
        }
    }
}

struct DistanceLabel: View {
    let distanceKm: Double
    var district: String?

    var body: some View {
        Text(distanceText)
            .font(.system(size: 13))
            .foregroundStyle(Color.dsTextSecondary)
    }

    private var distanceText: String {
        let distance = distanceKm < 1 ? String(format: "%.0fm", distanceKm * 1000) : String(format: "%.1fkm", distanceKm)
        if let district { return "\(district) · \(distance)" }
        return distance
    }
}

struct TrustMicroBadge: View {
    var text: String = "已实名"
    var tone: DSBadge.Tone = .primary

    var body: some View {
        DSBadge(text: text, tone: tone)
    }
}

struct TagChip: View {
    let title: String
    var color: Color = Color.dsPrimary
    var isSelected = false
    var action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) { chipLabel }.buttonStyle(.plain)
            } else {
                chipLabel
            }
        }
    }

    private var chipLabel: some View {
        Text(title)
            .font(.system(size: isSelected ? 15 : 13, weight: .medium))
            .foregroundStyle(isSelected ? Color.white : Color.dsTextPrimary)
            .padding(.horizontal, isSelected ? DS.Space.lg : DS.Space.md)
            .padding(.vertical, DS.Space.sm)
            .background(isSelected ? Color.dsPrimary : Color.dsBackground, in: Capsule())
            .overlay {
                if !isSelected {
                    Capsule().stroke(Color.dsBorder, lineWidth: 1)
                }
            }
    }
}

struct SectionHeader: View {
    let title: String
    var subtitle: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        DSSectionHeader(title: title, subtitle: subtitle, actionTitle: actionTitle, action: action)
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let subtitle: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Image(systemName: symbol)
                .font(.system(size: 32, weight: .regular))
                .foregroundStyle(Color.dsTextSecondary)
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            Text(subtitle)
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                DSSecondaryButton(title: actionTitle, action: action)
                    .frame(maxWidth: 220)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.Space.xxxl)
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = DS.Space.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(maxWidth: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(maxWidth: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y),
                proposal: .unspecified
            )
        }
    }

    private struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)
                if x + size.width > maxWidth && x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }
                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
            }
            self.size = CGSize(width: maxWidth, height: y + rowHeight)
        }
    }
}

struct UserAgreementSheet: View {
    let prompt: AgreementPrompt
    var onAcknowledge: () -> Void

    @State private var remainingSeconds: Int

    init(prompt: AgreementPrompt, onAcknowledge: @escaping () -> Void) {
        self.prompt = prompt
        self.onAcknowledge = onAcknowledge
        _remainingSeconds = State(initialValue: prompt.requiredReadSeconds)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.Space.lg) {
                        Text(prompt.message)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsDanger)
                            .padding(DS.Space.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.dsDanger.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))

                        Text(PlatformAgreement.title)
                            .font(.system(size: 17, weight: .semibold))

                        ForEach(Array(PlatformAgreement.sections.enumerated()), id: \.offset) { _, section in
                            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                                Text(section.0).font(.system(size: 15, weight: .semibold))
                                Text(section.1).font(.system(size: 13)).foregroundStyle(Color.dsTextSecondary)
                            }
                        }
                    }
                    .padding(DS.Space.lg)
                }

                VStack(spacing: DS.Space.sm) {
                    if prompt.requiredReadSeconds > 0, remainingSeconds > 0 {
                        Text("请阅读协议 \(remainingSeconds) 秒后可确认")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                    DSPrimaryButton(title: confirmTitle, isEnabled: canConfirm, action: onAcknowledge)
                }
                .padding(DS.Space.lg)
                .background(Color.dsSurface)
                .overlay(alignment: .top) { Divider() }
            }
            .background(Color.dsBackground)
            .navigationTitle("用户协议")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear { startCountdownIfNeeded() }
    }

    private var canConfirm: Bool { prompt.requiredReadSeconds == 0 || remainingSeconds <= 0 }

    private var confirmTitle: String {
        prompt.strikeNumber == 1 ? "我已知悉" : "我已阅读并知悉"
    }

    private func startCountdownIfNeeded() {
        guard prompt.requiredReadSeconds > 0 else { return }
        Task {
            while remainingSeconds > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                remainingSeconds -= 1
            }
        }
    }
}

extension View {
    @ViewBuilder
    func liquidGlass(cornerRadius: CGFloat, tint: Color = .clear, interactive: Bool = false) -> some View {
        self
    }

    @ViewBuilder
    func liquidGlassCapsule(tint: Color = .clear, interactive: Bool = false) -> some View {
        self
    }
}
