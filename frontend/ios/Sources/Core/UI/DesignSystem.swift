import SwiftUI

enum DS {
    enum Space {
        static let xxs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    enum Radius {
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 18
        static let xl: CGFloat = 26
        static let pill: CGFloat = 999
    }

    /// Calm listening-app type scale — prefer these over ad-hoc sizes on feature screens.
    enum TypeScale {
        static let display: CGFloat = 28
        static let title: CGFloat = 22
        static let section: CGFloat = 17
        static let body: CGFloat = 15
        static let callout: CGFloat = 13
        static let caption: CGFloat = 12
        static let micro: CGFloat = 11
    }

    enum Motion {
        static let fast: Double = 0.15
        static let normal: Double = 0.22
        static let gentle: Double = 0.32
    }

    enum ControlHeight {
        static let sm: CGFloat = 34
        static let md: CGFloat = 46
        static let lg: CGFloat = 52
    }

    enum Stroke {
        static let hairline: CGFloat = 0.75
        static let regular: CGFloat = 1
    }

    enum Elevation {
        static let cardShadowOpacity: Double = 0.035
        static let cardShadowRadius: CGFloat = 16
        static let cardShadowY: CGFloat = 6
        static let dockShadowOpacity: Double = 0.06
    }
}

extension Color {
    static let dsBackground = Color(red: 0.955, green: 0.970, blue: 0.958)
    static let dsSurface = Color(red: 1.000, green: 1.000, blue: 0.988)
    static let dsSurfaceElevated = Color(red: 0.995, green: 0.998, blue: 0.988)
    static let dsSurfaceMuted = Color(red: 0.925, green: 0.948, blue: 0.932)
    static let dsBorder = Color(red: 0.830, green: 0.865, blue: 0.842)
    static let dsTextPrimary = Color(red: 0.08, green: 0.10, blue: 0.10)
    static let dsTextSecondary = Color(red: 0.43, green: 0.47, blue: 0.46)
    static let dsPrimary = Color(red: 0.00, green: 0.40, blue: 0.36)
    static let dsPrimarySoft = Color(red: 0.860, green: 0.940, blue: 0.920)
    static let dsPressed = Color(red: 0.780, green: 0.885, blue: 0.860)
    static let dsSeparator = Color(red: 0.870, green: 0.900, blue: 0.880)
    static let dsSuccess = Color(red: 0.16, green: 0.62, blue: 0.34)
    static let dsWarning = Color(red: 0.80, green: 0.49, blue: 0.09)
    static let dsDanger = Color(red: 0.82, green: 0.18, blue: 0.17)
    static let dsHeroBottom = Color(red: 1.00, green: 0.98, blue: 0.94)

    static var appInk: Color { dsTextPrimary }
    static var appMuted: Color { dsTextSecondary }
    static var appTeal: Color { dsPrimary }
    static var appMist: Color { dsBackground }
    static var appWarm: Color { dsSurface }
    static var appCoral: Color { dsDanger }
    static var appGold: Color { dsWarning }
    static var appRose: Color { dsTextSecondary }
    static var appLilac: Color { dsTextSecondary }
}

struct DSCard<Content: View>: View {
    var padding: CGFloat = DS.Space.lg
    var isInset = false
    var elevated = true
    @ViewBuilder var content: Content

    var body: some View {
        let radius = isInset ? DS.Radius.sm : DS.Radius.lg
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isInset ? Color.dsSurfaceMuted.opacity(0.78) : Color.dsSurfaceElevated,
                in: RoundedRectangle(cornerRadius: radius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color.dsBorder.opacity(isInset ? 0.50 : 0.68), lineWidth: DS.Stroke.hairline)
            }
            .shadow(
                color: Color.dsTextPrimary.opacity(isInset || !elevated ? 0 : DS.Elevation.cardShadowOpacity),
                radius: DS.Elevation.cardShadowRadius,
                x: 0,
                y: DS.Elevation.cardShadowY
            )
    }
}

struct DSInsetSurface<Content: View>: View {
    var padding: CGFloat = DS.Space.md
    @ViewBuilder var content: Content

    var body: some View {
        DSCard(padding: padding, isInset: true) {
            content
        }
    }
}

struct DSButton: View {
    enum Variant { case primary, secondary, quiet, danger }

    let title: String
    var systemImage: String?
    var variant: Variant = .primary
    var isEnabled = true
    var isLoading = false
    var maxWidth: CGFloat? = .infinity
    var height: CGFloat = DS.ControlHeight.md
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.sm) {
                if isLoading {
                    ProgressView()
                        .tint(progressTint)
                        .controlSize(.small)
                } else if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(title)
                    .font(.system(size: DS.TypeScale.body, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .padding(.horizontal, DS.Space.lg)
            .frame(maxWidth: maxWidth)
            .frame(height: height)
            .foregroundStyle(foreground)
            .background(background, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(border, lineWidth: DS.Stroke.hairline)
            }
            .shadow(color: shadow, radius: 10, x: 0, y: 5)
        }
        .disabled(!isEnabled || isLoading)
        .buttonStyle(DSPressButtonStyle())
    }

    private var foreground: Color {
        guard isEnabled else { return Color.dsTextSecondary.opacity(0.70) }
        switch variant {
        case .primary, .danger:
            return .white
        case .secondary, .quiet:
            return Color.dsPrimary
        }
    }

    private var background: Color {
        guard isEnabled else { return Color.dsSurfaceMuted.opacity(0.85) }
        switch variant {
        case .primary:
            return Color.dsPrimary
        case .secondary:
            return Color.dsSurfaceElevated
        case .quiet:
            return Color.dsPrimarySoft.opacity(0.74)
        case .danger:
            return Color.dsDanger
        }
    }

    private var border: Color {
        guard isEnabled else { return Color.dsBorder.opacity(0.45) }
        switch variant {
        case .primary:
            return Color.dsPrimary.opacity(0.10)
        case .secondary:
            return Color.dsBorder.opacity(0.82)
        case .quiet:
            return Color.dsPrimary.opacity(0.16)
        case .danger:
            return Color.dsDanger.opacity(0.12)
        }
    }

    private var shadow: Color {
        guard isEnabled else { return .clear }
        switch variant {
        case .primary:
            return Color.dsPrimary.opacity(0.18)
        case .danger:
            return Color.dsDanger.opacity(0.16)
        case .secondary, .quiet:
            return .clear
        }
    }

    private var progressTint: Color {
        switch variant {
        case .primary, .danger:
            return .white
        case .secondary, .quiet:
            return Color.dsPrimary
        }
    }
}

struct DSIconButton: View {
    let systemImage: String
    var tone: DSBadge.Tone = .neutral
    var size: CGFloat = DS.ControlHeight.md
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.38, weight: .semibold))
                .frame(width: size, height: size)
                .foregroundStyle(foreground)
                .background(background, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                        .stroke(border, lineWidth: DS.Stroke.hairline)
                }
        }
        .buttonStyle(DSPressButtonStyle())
    }

    private var foreground: Color {
        switch tone {
        case .neutral: Color.dsTextPrimary
        case .primary: Color.dsPrimary
        case .success: Color.dsSuccess
        case .warning: Color.dsWarning
        case .danger: Color.dsDanger
        }
    }

    private var background: Color {
        switch tone {
        case .neutral: Color.dsSurfaceElevated
        case .primary: Color.dsPrimarySoft.opacity(0.78)
        case .success: Color.dsSuccess.opacity(0.10)
        case .warning: Color.dsWarning.opacity(0.10)
        case .danger: Color.dsDanger.opacity(0.10)
        }
    }

    private var border: Color {
        tone == .neutral ? Color.dsBorder.opacity(0.78) : foreground.opacity(0.18)
    }
}

struct DSPrimaryButton: View {
    let title: String
    var systemImage: String?
    var isEnabled = true
    var isLoading = false
    let action: () -> Void

    var body: some View {
        DSButton(title: title, systemImage: systemImage, variant: .primary, isEnabled: isEnabled, isLoading: isLoading, action: action)
    }
}

struct DSSecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        DSButton(title: title, variant: .secondary, action: action)
    }
}

struct DSPressButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.86 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: DS.Motion.fast), value: configuration.isPressed)
    }
}

struct DSListRow: View {
    let title: String
    var subtitle: String?
    var trailing: String?
    var symbol: String?
    var action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) { rowContent }
                    .buttonStyle(.plain)
            } else {
                rowContent
            }
        }
    }

    private var rowContent: some View {
        HStack(spacing: DS.Space.md) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.dsPrimary)
                    .frame(width: 24)
            }
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.dsTextPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: DS.Space.sm)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.dsTextSecondary)
            }
            if action != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.md)
        .contentShape(Rectangle())
    }
}

struct DSBadge: View {
    enum Tone: Equatable { case neutral, primary, success, warning, danger }

    let text: String
    var tone: Tone = .neutral

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .background(background, in: Capsule())
            .overlay {
                Capsule()
                    .stroke(foreground.opacity(0.12), lineWidth: DS.Stroke.hairline)
            }
    }

    private var foreground: Color {
        switch tone {
        case .neutral: Color.dsTextSecondary
        case .primary: Color.dsPrimary
        case .success: Color.dsSuccess
        case .warning: Color.dsWarning
        case .danger: Color.dsDanger
        }
    }

    private var background: Color {
        foreground.opacity(0.12)
    }
}

struct DSInitialsAvatar: View {
    let initials: String
    var tone: DSBadge.Tone = .primary
    var size: CGFloat = 40
    var statusColor: Color?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(background)
            Text(String(initials.prefix(2)))
                .font(.system(size: max(10, size * 0.34), weight: .semibold))
                .foregroundStyle(foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(width: size, height: size)
        .overlay {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .stroke(foreground.opacity(0.12), lineWidth: DS.Stroke.hairline)
        }
        .overlay(alignment: .bottomTrailing) {
            if let statusColor {
                Circle()
                    .fill(statusColor)
                    .frame(width: max(8, size * 0.22), height: max(8, size * 0.22))
                    .overlay(Circle().stroke(Color.dsSurfaceElevated, lineWidth: 2))
            }
        }
    }

    private var radius: CGFloat { min(DS.Radius.lg, size * 0.28) }

    private var foreground: Color {
        switch tone {
        case .neutral: Color.dsTextSecondary
        case .primary: Color.dsPrimary
        case .success: Color.dsSuccess
        case .warning: Color.dsWarning
        case .danger: Color.dsDanger
        }
    }

    private var background: Color {
        switch tone {
        case .neutral: Color.dsSurfaceMuted
        case .primary: Color.dsPrimarySoft
        case .success: Color.dsSuccess.opacity(0.10)
        case .warning: Color.dsWarning.opacity(0.10)
        case .danger: Color.dsDanger.opacity(0.10)
        }
    }
}

struct DSBanner: View {
    let title: String
    var message: String?
    var systemImage: String = "info.circle.fill"
    var tone: DSBadge.Tone = .primary

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.md) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(foreground)
                .frame(width: 22, height: 22)

            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                if let message {
                    Text(message)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.dsTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: DS.Space.sm)
        }
        .padding(.horizontal, DS.Space.md)
        .padding(.vertical, DS.Space.sm)
        .background(background, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                .stroke(foreground.opacity(0.13), lineWidth: DS.Stroke.hairline)
        }
    }

    private var foreground: Color {
        switch tone {
        case .neutral: Color.dsTextSecondary
        case .primary: Color.dsPrimary
        case .success: Color.dsSuccess
        case .warning: Color.dsWarning
        case .danger: Color.dsDanger
        }
    }

    private var background: Color {
        switch tone {
        case .neutral: Color.dsSurfaceMuted.opacity(0.82)
        case .primary: Color.dsPrimarySoft.opacity(0.72)
        case .success: Color.dsSuccess.opacity(0.10)
        case .warning: Color.dsWarning.opacity(0.10)
        case .danger: Color.dsDanger.opacity(0.10)
        }
    }
}

struct DSSectionHeader: View {
    let title: String
    var subtitle: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.md) {
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: DS.TypeScale.section, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: DS.TypeScale.callout))
                        .foregroundStyle(Color.dsTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: DS.Space.sm)
            if let actionTitle, let action {
                Button(action: action) {
                    HStack(spacing: DS.Space.xxs) {
                        Text(actionTitle)
                            .font(.system(size: DS.TypeScale.callout, weight: .semibold))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .foregroundStyle(Color.dsPrimary)
                    .padding(.horizontal, DS.Space.md)
                    .frame(height: DS.ControlHeight.sm)
                    .background(Color.dsPrimarySoft.opacity(0.58), in: Capsule())
                }
                .buttonStyle(DSPressButtonStyle())
            }
        }
    }
}

struct DSInputField: View {
    let placeholder: String
    @Binding var text: String
    var axis: Axis = .horizontal
    var lineLimit: ClosedRange<Int> = 1...1
    var keyboardType: UIKeyboardType = .default

    var body: some View {
        TextField(placeholder, text: $text, axis: axis)
            .lineLimit(lineLimit)
            .keyboardType(keyboardType)
            .font(.system(size: 15))
            .padding(.horizontal, DS.Space.md)
            .padding(.vertical, DS.Space.md)
            .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(Color.dsBorder.opacity(0.82), lineWidth: DS.Stroke.hairline)
            }
    }
}

struct DSTextEditor: View {
    let placeholder: String
    @Binding var text: String
    var minHeight: CGFloat = 132

    private var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if trimmedText.isEmpty {
                Text(placeholder)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.dsTextSecondary)
                    .padding(.horizontal, DS.Space.md)
                    .padding(.vertical, DS.Space.md)
            }

            TextEditor(text: $text)
                .font(.system(size: 15))
                .scrollContentBackground(.hidden)
                .padding(.horizontal, DS.Space.sm)
                .padding(.vertical, DS.Space.sm)
                .frame(minHeight: minHeight)
        }
        .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                .stroke(Color.dsBorder.opacity(0.82), lineWidth: DS.Stroke.hairline)
        }
    }
}
