import SwiftUI

struct AppBackground: View {
    var body: some View {
        ZStack {
            Color.dsBackground
            LinearGradient(
                colors: [
                    Color.dsPrimarySoft.opacity(0.55),
                    Color.dsBackground.opacity(0.2),
                    Color.dsHeroBottom.opacity(0.48)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .ignoresSafeArea()
    }
}

struct AppScaffold<Content: View>: View {
    let title: String
    var spacing: CGFloat = DS.Space.xl
    var horizontalPadding: CGFloat = DS.Space.lg
    var topPadding: CGFloat = DS.Space.md
    var bottomPadding: CGFloat = 104
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
        .background(AppBackground())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground.opacity(0.94), for: .navigationBar)
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

struct ActionDock<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(DS.Space.lg)
            .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.xl, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.xl, style: .continuous)
                    .stroke(Color.dsBorder.opacity(0.65), lineWidth: DS.Stroke.hairline)
            }
            .shadow(
                color: Color.dsTextPrimary.opacity(DS.Elevation.dockShadowOpacity),
                radius: 20,
                x: 0,
                y: 10
            )
            .padding(.horizontal, DS.Space.md)
            .padding(.bottom, DS.Space.sm)
    }
}

struct CompanionAvatar: View {
    let companion: Companion
    var size: CGFloat = 48

    var body: some View {
        DSInitialsAvatar(initials: companion.initials, tone: .primary, size: size, statusColor: companion.availabilityColor)
        .accessibilityLabel("\(companion.name)头像")
    }
}

struct StatusPill: View {
    let text: String
    let symbol: String
    var color: Color = Color.dsPrimary

    var body: some View {
        HStack(spacing: DS.Space.xxs) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
            Text(text)
                .font(.system(size: 11, weight: .medium))
        }
        .foregroundStyle(color)
        .padding(.horizontal, DS.Space.sm)
        .padding(.vertical, DS.Space.xxs)
        .background(color.opacity(0.10), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.12), lineWidth: DS.Stroke.hairline))
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

struct CompanionSummaryCard: View {
    let companion: Companion

    var body: some View {
        DSCard(padding: DS.Space.lg) {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HStack(alignment: .top, spacing: DS.Space.md) {
                    CompanionAvatar(companion: companion, size: 52)

                    VStack(alignment: .leading, spacing: DS.Space.xxs) {
                        HStack(alignment: .center, spacing: DS.Space.sm) {
                            Text(companion.name)
                                .font(.system(size: DS.TypeScale.body + 1, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                                .lineLimit(1)
                            AvailabilityBadge(status: companion.availability)
                            if companion.isVerified {
                                TrustMicroBadge()
                            }
                        }

                        Text(companion.role)
                            .font(.system(size: DS.TypeScale.caption))
                            .foregroundStyle(Color.dsTextSecondary)
                            .lineLimit(1)

                        HStack(spacing: DS.Space.sm) {
                            Label(companion.responseTime, systemImage: "bolt.fill")
                            if companion.rating > 0 {
                                Label(String(format: "%.1f", companion.rating), systemImage: "star.fill")
                            }
                            if companion.completedOrders > 0 {
                                Text("\(companion.completedOrders)单")
                            }
                        }
                        .font(.system(size: DS.TypeScale.micro, weight: .medium))
                        .foregroundStyle(Color.dsTextSecondary)
                        .padding(.top, DS.Space.xxs)
                    }

                    Spacer(minLength: DS.Space.sm)

                    VStack(alignment: .trailing, spacing: 2) {
                        Text("¥\(companion.pricePerHalfHour)")
                            .font(.system(size: DS.TypeScale.section, weight: .semibold))
                            .foregroundStyle(Color.dsPrimary)
                        Text("/30分钟")
                            .font(.system(size: DS.TypeScale.micro, weight: .medium))
                            .foregroundStyle(Color.dsTextSecondary)
                    }
                }

                if !companion.tags.isEmpty {
                    FlowLayout(spacing: DS.Space.sm) {
                        ForEach(companion.tags.prefix(3), id: \.self) { tag in
                            TagChip(title: tag)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(companion.name)，\(companion.role)，\(companion.availability.displayName)，\(companion.responseTime)，\(companion.pricePerHalfHour)元30分钟")
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
            .font(.system(size: DS.TypeScale.callout, weight: isSelected ? .semibold : .medium))
            .foregroundStyle(isSelected ? Color.white : Color.dsTextPrimary)
            .padding(.horizontal, isSelected ? DS.Space.lg : DS.Space.md)
            .frame(height: DS.ControlHeight.sm)
            .background(isSelected ? color : Color.dsSurfaceMuted.opacity(0.85), in: Capsule())
            .overlay {
                if !isSelected {
                    Capsule().stroke(Color.dsBorder.opacity(0.70), lineWidth: DS.Stroke.hairline)
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
    var compact = false

    init(
        symbol: String,
        title: String,
        subtitle: String,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil,
        compact: Bool = false
    ) {
        self.symbol = symbol
        self.title = title
        self.subtitle = subtitle
        self.actionTitle = actionTitle
        self.action = action
        self.compact = compact
    }

    /// Build from centralized marketplace empty-state copy.
    init(content: MarketplaceEmptyCopy.Content, action: (() -> Void)? = nil, compact: Bool = false) {
        self.symbol = content.symbol
        self.title = content.title
        self.subtitle = content.subtitle
        self.actionTitle = content.actionTitle
        self.action = action
        self.compact = compact
    }

    var body: some View {
        VStack(spacing: DS.Space.md) {
            ZStack {
                Circle()
                    .fill(Color.dsPrimarySoft.opacity(0.72))
                    .frame(width: compact ? 56 : 68, height: compact ? 56 : 68)
                Image(systemName: symbol)
                    .font(.system(size: compact ? 22 : 26, weight: .regular))
                    .foregroundStyle(Color.dsPrimary)
                    .symbolRenderingMode(.hierarchical)
            }
            .accessibilityHidden(true)

            VStack(spacing: DS.Space.sm) {
                Text(title)
                    .font(.system(size: DS.TypeScale.section, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                    .multilineTextAlignment(.center)
                Text(subtitle)
                    .font(.system(size: DS.TypeScale.callout))
                    .foregroundStyle(Color.dsTextSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 280)
            }

            if let actionTitle, let action {
                DSButton(title: actionTitle, systemImage: "arrow.right", variant: .secondary, maxWidth: 200, action: action)
                    .padding(.top, DS.Space.xxs)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, compact ? DS.Space.xl : DS.Space.xxl)
        .padding(.horizontal, DS.Space.md)
    }
}

/// Card-wrapped empty state for list / feed shells (Discover, Community, Companion list).
struct EmptyStateCard: View {
    let content: MarketplaceEmptyCopy.Content
    var action: (() -> Void)?
    var secondaryTitle: String?
    var secondaryAction: (() -> Void)?

    var body: some View {
        DSCard(padding: DS.Space.xl, elevated: false) {
            VStack(spacing: DS.Space.md) {
                EmptyStateView(content: content, action: nil, compact: true)
                    .padding(.vertical, 0)

                if content.actionTitle != nil || secondaryTitle != nil {
                    HStack(spacing: DS.Space.sm) {
                        if let actionTitle = content.actionTitle, let action {
                            DSButton(title: actionTitle, variant: .primary, action: action)
                        }
                        if let secondaryTitle, let secondaryAction {
                            DSButton(title: secondaryTitle, variant: .secondary, maxWidth: 120, action: secondaryAction)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
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
                        DSBanner(
                            title: prompt.message,
                            systemImage: "exclamationmark.triangle.fill",
                            tone: .danger
                        )

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
