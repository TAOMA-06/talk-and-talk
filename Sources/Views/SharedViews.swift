import SwiftUI

struct AppBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 1.00, green: 0.99, blue: 0.97),
                    Color(red: 0.98, green: 0.97, blue: 0.95),
                    Color(red: 0.96, green: 0.98, blue: 0.96),
                    Color(red: 1.00, green: 0.97, blue: 0.95)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    Color.white.opacity(0.4),
                    Color.appTeal.opacity(0.04),
                    Color.appRose.opacity(0.04)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }
}

struct AppScaffold<Content: View>: View {
    let title: String
    var spacing: CGFloat = 20
    var horizontalPadding: CGFloat = 18
    var topPadding: CGFloat = 12
    var bottomPadding: CGFloat = 118
    var showsIndicators = false
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            AppBackground()
            ScrollView(showsIndicators: showsIndicators) {
                VStack(alignment: .leading, spacing: spacing) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, horizontalPadding)
                .padding(.top, topPadding)
                .padding(.bottom, bottomPadding)
            }
            .scrollContentBackground(.hidden)
        }
        .background(AppBackground())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
    }
}

struct GlassSurface<Content: View>: View {
    var cornerRadius: CGFloat = 22
    var tint: Color = .white.opacity(0.18)
    var padding: CGFloat = 16
    var interactive = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.appWarm.opacity(0.92))
                    .shadow(color: Color.appInk.opacity(0.04), radius: 18, x: 0, y: 10)
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(.white.opacity(0.85), lineWidth: 0.7)
            }
            .liquidGlass(cornerRadius: cornerRadius, tint: tint, interactive: interactive)
    }
}

struct SoftCard<Content: View>: View {
    var cornerRadius: CGFloat = 20
    var tint: Color = Color.appTeal
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.appWarm)
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(tint.opacity(0.06))
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(tint.opacity(0.15), lineWidth: 0.8)
            }
            .shadow(color: Color.appInk.opacity(0.03), radius: 12, x: 0, y: 6)
    }
}

struct GlassPanel<Content: View>: View {
    var cornerRadius: CGFloat = 24
    var tint: Color = .white.opacity(0.24)
    @ViewBuilder var content: Content

    var body: some View {
        GlassSurface(cornerRadius: cornerRadius, tint: tint, padding: 16, interactive: false) {
            content
        }
    }
}

struct GlassCapsule<Content: View>: View {
    var tint: Color = .white.opacity(0.18)
    var interactive = true
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.white.opacity(0.42), in: Capsule())
            .liquidGlassCapsule(tint: tint, interactive: interactive)
    }
}

struct PrimaryActionButton: View {
    let title: String
    let systemImage: String
    var isEnabled = true
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .disabled(!isEnabled)
        .buttonStyle(GlassPrimaryButtonStyle())
    }
}

struct GlassPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.appInk.opacity(configuration.isPressed ? 0.82 : 0.95))
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
            .liquidGlass(cornerRadius: 18, tint: Color.appTeal.opacity(0.2), interactive: true)
    }
}

struct ModernHero: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let primaryTitle: String
    let primarySystemImage: String
    var secondary: String?
    var metricTitle: String = "审核"
    var metricValue: String = "18+"
    let action: () -> Void

    var body: some View {
        GlassSurface(cornerRadius: 24, tint: Color.appTeal.opacity(0.12), padding: 18, interactive: false) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(eyebrow)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.appTeal)
                        Text(title)
                            .font(.system(size: 25, weight: .bold, design: .rounded))
                            .foregroundStyle(Color.appInk)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    FloatingMetric(title: metricTitle, value: metricValue, symbol: "shield.checkered", tint: Color.appTeal)
                }

                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Color.appMuted)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)

                PrimaryActionButton(title: primaryTitle, systemImage: primarySystemImage, action: action)

                if let secondary {
                    Text(secondary)
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                        .lineSpacing(2)
                }
            }
        }
    }
}

struct FloatingMetric: View {
    let title: String
    let value: String
    let symbol: String
    var tint: Color = Color.appTeal

    var body: some View {
        VStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(tint)
            Text(value)
                .font(.headline.bold())
                .foregroundStyle(Color.appInk)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.appMuted)
        }
        .frame(width: 70, height: 72)
        .background(.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .liquidGlass(cornerRadius: 18, tint: tint.opacity(0.12), interactive: false)
    }
}

struct ActionDock<Content: View>: View {
    var tint: Color = .white.opacity(0.2)
    @ViewBuilder var content: Content

    var body: some View {
        GlassSurface(cornerRadius: 26, tint: tint, padding: 12, interactive: false) {
            content
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
        .background(.clear)
    }
}

struct CompanionAvatar: View {
    let companion: Companion
    var size: CGFloat = 64

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: avatarColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Text(companion.initials)
                .font(.system(size: size * 0.32, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            Circle()
                .fill(companion.availabilityColor)
                .frame(width: size * 0.18, height: size * 0.18)
                .overlay(Circle().stroke(.white, lineWidth: 2))
                .offset(x: 2, y: 2)
        }
        .accessibilityLabel("\(companion.name)头像")
    }

    private var avatarColors: [Color] {
        let palettes: [[Color]] = [
            [Color.appTeal, Color.appLilac],
            [Color.appCoral, Color.appGold],
            [Color.appInk, Color.appTeal],
            [Color.appLilac, Color.appCoral]
        ]
        let index = abs(companion.id.hashValue) % palettes.count
        return palettes[index]
    }
}

struct StatusPill: View {
    let text: String
    let symbol: String
    var color: Color = Color.appTeal

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(color.opacity(0.1), in: Capsule())
    }
}

struct AvailabilityBadge: View {
    let status: AvailabilityStatus

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(status.displayName)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(statusColor)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(statusColor.opacity(0.1), in: Capsule())
    }

    private var statusColor: Color {
        switch status {
        case .online: Color.appTeal
        case .available: Color(red: 0.22, green: 0.68, blue: 0.42)
        case .busy: Color.appMuted
        }
    }
}

struct DistanceLabel: View {
    let distanceKm: Double
    var district: String?

    var body: some View {
        Label(distanceText, systemImage: "location.fill")
            .font(.caption2.weight(.medium))
            .foregroundStyle(Color.appMuted)
    }

    private var distanceText: String {
        if let district {
            return "\(district) · \(formattedDistance)"
        }
        return formattedDistance
    }

    private var formattedDistance: String {
        distanceKm < 1 ? String(format: "%.0fm", distanceKm * 1000) : String(format: "%.1fkm", distanceKm)
    }
}

struct TrustMicroBadge: View {
    var text: String = "已实名"
    var symbol: String = "checkmark.seal.fill"
    var color: Color = Color.appTeal

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.1), in: Capsule())
    }
}

struct TagChip: View {
    let title: String
    var color: Color = Color.appTeal
    var isSelected = false
    var action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) {
                    chipLabel
                }
                .buttonStyle(.plain)
            } else {
                chipLabel
            }
        }
    }

    private var chipLabel: some View {
        Text(title)
            .font(isSelected ? .subheadline.weight(.semibold) : .caption2.weight(.medium))
            .foregroundStyle(isSelected ? .white : Color.appInk)
            .padding(.horizontal, isSelected ? 14 : 10)
            .padding(.vertical, isSelected ? 9 : 5)
            .background(chipBackground, in: Capsule())
    }

    private var chipBackground: Color {
        isSelected ? Color.appTeal : color.opacity(0.1)
    }
}

struct SectionHeader: View {
    let title: String
    var subtitle: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Color.appInk)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.appMuted)
                }
            }
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.appTeal)
            }
        }
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(Color.appTeal)
            Text(title)
                .font(.headline)
                .foregroundStyle(Color.appInk)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Color.appMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 52)
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

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
                    VStack(alignment: .leading, spacing: 18) {
                        Text(prompt.message)
                            .font(.subheadline)
                            .foregroundStyle(Color.appCoral)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.appCoral.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                        Text(PlatformAgreement.title)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(Color.appInk)

                        ForEach(Array(PlatformAgreement.sections.enumerated()), id: \.offset) { _, section in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(section.0)
                                    .font(.headline)
                                    .foregroundStyle(Color.appInk)
                                Text(section.1)
                                    .font(.subheadline)
                                    .foregroundStyle(Color.appMuted)
                                    .lineSpacing(4)
                            }
                        }
                    }
                    .padding(20)
                }

                VStack(spacing: 10) {
                    if prompt.requiredReadSeconds > 0, remainingSeconds > 0 {
                        Text("请阅读协议 \(remainingSeconds) 秒后可确认")
                            .font(.caption)
                            .foregroundStyle(Color.appMuted)
                    }
                    Button(action: onAcknowledge) {
                        Text(confirmTitle)
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.appTeal)
                    .disabled(!canConfirm)
                }
                .padding(20)
                .background(Color.appWarm)
            }
            .navigationTitle("用户协议")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            startCountdownIfNeeded()
        }
    }

    private var canConfirm: Bool {
        prompt.requiredReadSeconds == 0 || remainingSeconds <= 0
    }

    private var confirmTitle: String {
        prompt.strikeNumber == 1 ? "我已知悉（首次提醒）" : "我已阅读并知悉"
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
    func liquidGlass(cornerRadius: CGFloat, tint: Color = .white.opacity(0.2), interactive: Bool) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(tint).interactive(interactive), in: .rect(cornerRadius: cornerRadius))
        } else {
            self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }

    @ViewBuilder
    func liquidGlassCapsule(tint: Color = .white.opacity(0.2), interactive: Bool) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(tint).interactive(interactive), in: .capsule)
        } else {
            self.background(.ultraThinMaterial, in: Capsule())
        }
    }
}
