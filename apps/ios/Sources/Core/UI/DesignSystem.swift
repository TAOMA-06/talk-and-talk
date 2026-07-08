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
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let xl: CGFloat = 24
    }

    enum Motion {
        static let fast: Double = 0.15
        static let normal: Double = 0.2
    }
}

enum DSTypography {
    static func title(_ text: String) -> Text {
        Text(text).font(.system(size: 22, weight: .semibold)).foregroundStyle(Color.dsTextPrimary)
    }

    static func sectionTitle(_ text: String) -> Text {
        Text(text).font(.system(size: 17, weight: .semibold)).foregroundStyle(Color.dsTextPrimary)
    }

    static func body(_ text: String) -> Text {
        Text(text).font(.system(size: 15, weight: .regular)).foregroundStyle(Color.dsTextPrimary)
    }

    static func caption(_ text: String) -> Text {
        Text(text).font(.system(size: 13, weight: .regular)).foregroundStyle(Color.dsTextSecondary)
    }

    static func label(_ text: String) -> Text {
        Text(text).font(.system(size: 11, weight: .medium)).foregroundStyle(Color.dsTextSecondary)
    }
}

extension Color {
    static let dsBackground = Color(red: 0.96, green: 0.97, blue: 0.96)
    static let dsSurface = Color(red: 1.00, green: 1.00, blue: 0.99)
    static let dsBorder = Color(red: 0.86, green: 0.88, blue: 0.86)
    static let dsTextPrimary = Color(red: 0.08, green: 0.10, blue: 0.10)
    static let dsTextSecondary = Color(red: 0.43, green: 0.47, blue: 0.46)
    static let dsPrimary = Color(red: 0.00, green: 0.40, blue: 0.36)
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
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                    .stroke(Color.dsBorder.opacity(0.78), lineWidth: 1)
            }
            .shadow(color: Color.dsTextPrimary.opacity(0.045), radius: 10, x: 0, y: 5)
    }
}

struct DSPrimaryButton: View {
    let title: String
    var systemImage: String?
    var isEnabled = true
    var isLoading = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.Space.sm) {
                if isLoading {
                    ProgressView().tint(.white)
                } else if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, DS.Space.md)
            .foregroundStyle(.white)
            .background(isEnabled ? Color.dsPrimary : Color.dsTextSecondary.opacity(0.4), in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
            .shadow(color: isEnabled ? Color.dsPrimary.opacity(0.22) : Color.clear, radius: 12, x: 0, y: 6)
        }
        .disabled(!isEnabled || isLoading)
        .buttonStyle(DSPressButtonStyle())
    }
}

struct DSSecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, DS.Space.md)
                .foregroundStyle(Color.dsPrimary)
                .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                        .stroke(Color.dsBorder, lineWidth: 1)
                }
        }
        .buttonStyle(DSPressButtonStyle())
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
    enum Tone { case neutral, primary, success, warning, danger }

    let text: String
    var tone: Tone = .neutral

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .background(background, in: Capsule())
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

struct DSLoadingView: View {
    var message = "加载中..."

    var body: some View {
        VStack(spacing: DS.Space.md) {
            ProgressView()
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.Space.xxxl)
    }
}

struct DSErrorView: View {
    let title: String
    let message: String
    var retryTitle = "重试"
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundStyle(Color.dsDanger)
            Text(title)
                .font(.system(size: 17, weight: .semibold))
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
                .multilineTextAlignment(.center)
            if let onRetry {
                DSPrimaryButton(title: retryTitle, action: onRetry)
                    .frame(maxWidth: 200)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(DS.Space.xl)
    }
}

struct DSToast: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.md)
            .background(Color.dsTextPrimary.opacity(0.92), in: Capsule())
    }
}

struct DSSectionHeader: View {
    let title: String
    var subtitle: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: DS.Space.xxs) {
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.dsTextPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.dsTextSecondary)
                }
            }
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.dsPrimary)
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
            .background(Color.dsSurface, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                    .stroke(Color.dsBorder, lineWidth: 1)
            }
    }
}
