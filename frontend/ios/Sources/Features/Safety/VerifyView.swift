import SwiftUI

private enum VerifyField: Hashable {
    case name, age, phone, code
}

struct VerifyView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: VerifyField?

    @State private var step = 0
    @State private var name = ""
    @State private var age = ""
    @State private var phone = ""
    @State private var code = ""
    @State private var faceScanComplete = false

    private var canContinue: Bool {
        switch step {
        case 0: Int(age).map { $0 >= 18 } == true && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case 1: faceScanComplete
        default: phone.filter(\.isNumber).count >= 11 && code.filter(\.isNumber).count >= 4
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                DSBanner(
                    title: "完成认证后即可下单与试聊",
                    message: "信息仅用于年龄核验，可离线完成演示流程。",
                    systemImage: "person.badge.key",
                    tone: .primary
                )
                VerifyProgress(step: step)
                currentStep
                DSPrimaryButton(
                    title: step == 2 ? "完成认证" : "下一步",
                    systemImage: "arrow.right",
                    isEnabled: canContinue,
                    action: advance
                )
                .accessibilityIdentifier(step == 2 ? "verifyCompleteButton" : "verifyNextButton")
                if step > 0 {
                    DSSecondaryButton(title: "上一步", action: goBack)
                        .accessibilityIdentifier("verifyBackButton")
                }
                Button(action: openSafetyCenter) {
                    HStack {
                        Text("查看安全中心")
                        Image(systemName: "arrow.right")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.dsPrimary)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("查看安全中心")
                .accessibilityIdentifier("verifySafetyCenterButton")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DS.Space.lg)
            .padding(.top, DS.Space.md)
            .padding(.bottom, DS.Space.xxxl)
        }
        .accessibilityIdentifier("verifyView")
        .scrollDismissesKeyboard(.interactively)
        .background(Color.dsBackground)
        .navigationTitle("18+ 实名认证")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar(.visible, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("关闭") { dismiss() }
                    .accessibilityIdentifier("verifyCloseButton")
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { focusedField = nil }
            }
        }
        .onAppear {
            // Ensure first field can take focus after navigation push.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                if step == 0 { focusedField = .name }
            }
        }
        .onChange(of: step) { _, newStep in
            DispatchQueue.main.async {
                switch newStep {
                case 0: focusedField = .name
                case 2: focusedField = .phone
                default: focusedField = nil
                }
            }
        }
    }

    @ViewBuilder
    private var currentStep: some View {
        switch step {
        case 0:
            IdentityStep(name: $name, age: $age, focusedField: $focusedField)
        case 1:
            FaceStep(isComplete: $faceScanComplete)
        default:
            PhoneStep(phone: $phone, code: $code, focusedField: $focusedField)
        }
    }

    private func advance() {
        focusedField = nil
        if step < 2 {
            withAnimation(.easeOut(duration: DS.Motion.fast)) { step += 1 }
        } else {
            Task {
                if await store.verifyUser(name: name, phone: phone, age: Int(age) ?? 18) {
                    dismiss()
                }
            }
        }
    }

    private func goBack() {
        focusedField = nil
        withAnimation(.easeOut(duration: DS.Motion.fast)) {
            step = max(0, step - 1)
        }
    }

    private func openSafetyCenter() {
        focusedField = nil
        store.navigate(.safetyCenter)
    }
}

private struct VerifyProgress: View {
    let step: Int
    private let labels = ["身份", "人脸", "手机"]

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.sm) {
                HStack(spacing: DS.Space.sm) {
                    ForEach(0..<3, id: \.self) { item in
                        Capsule()
                            .fill(item <= step ? Color.dsPrimary : Color.dsBorder)
                            .frame(height: 4)
                    }
                }
                HStack {
                    ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                        Text(label)
                            .font(.system(size: 11, weight: index == step ? .semibold : .medium))
                            .foregroundStyle(index == step ? Color.dsPrimary : Color.dsTextSecondary)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }
}

private struct IdentityStep: View {
    @Binding var name: String
    @Binding var age: String
    var focusedField: FocusState<VerifyField?>.Binding

    private var ageOK: Bool {
        Int(age).map { $0 >= 18 } == true
    }

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                StepTitle(symbol: "person.text.rectangle", title: "确认 18+ 身份", subtitle: "用于确认年满 18 岁（演示可本地完成）")

                VerifyLabeledField(title: "姓名", isFocused: focusedField.wrappedValue == .name) {
                    TextField("请输入姓名", text: $name)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused(focusedField, equals: .name)
                        .onSubmit { focusedField.wrappedValue = .age }
                        .accessibilityIdentifier("verifyNameField")
                }

                VerifyLabeledField(title: "年龄", isFocused: focusedField.wrappedValue == .age) {
                    TextField("请输入年龄，如 24", text: $age)
                        .keyboardType(.numberPad)
                        .textContentType(.none)
                        .autocorrectionDisabled()
                        .focused(focusedField, equals: .age)
                        .accessibilityIdentifier("verifyAgeField")
                }

                StatusPill(
                    text: ageOK ? "年龄符合" : "需年满 18 岁",
                    symbol: "18.circle",
                    color: ageOK ? Color.dsSuccess : Color.dsWarning
                )
            }
        }
    }
}

private struct FaceStep: View {
    @Binding var isComplete: Bool

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.lg) {
                StepTitle(symbol: "faceid", title: "人脸识别", subtitle: "演示流程：点一下即可通过")
                Button {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { isComplete = true }
                } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                            .stroke(style: StrokeStyle(lineWidth: 1, dash: [6]))
                            .foregroundStyle(isComplete ? Color.dsSuccess : Color.dsBorder)
                            .frame(height: 160)
                        VStack(spacing: DS.Space.md) {
                            Image(systemName: isComplete ? "checkmark.seal.fill" : "faceid")
                                .font(.system(size: 44, weight: .regular))
                                .foregroundStyle(isComplete ? Color.dsSuccess : Color.dsTextPrimary)
                            Text(isComplete ? "活体检测已通过" : "开始检测")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isComplete ? "活体检测已通过" : "开始检测")
                .accessibilityIdentifier(isComplete ? "活体检测已通过" : "开始检测")
            }
        }
    }
}

private struct PhoneStep: View {
    @Binding var phone: String
    @Binding var code: String
    var focusedField: FocusState<VerifyField?>.Binding

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                StepTitle(symbol: "iphone.gen3", title: "绑定手机号", subtitle: "演示模式任意 11 位手机号 + 4 位验证码即可")

                VerifyLabeledField(title: "手机号", isFocused: focusedField.wrappedValue == .phone) {
                    TextField("请输入 11 位手机号", text: $phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .autocorrectionDisabled()
                        .focused(focusedField, equals: .phone)
                        .accessibilityIdentifier("verifyPhoneField")
                }

                VerifyLabeledField(title: "验证码", isFocused: focusedField.wrappedValue == .code) {
                    TextField("请输入验证码（演示填 1234）", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .autocorrectionDisabled()
                        .focused(focusedField, equals: .code)
                        .accessibilityIdentifier("verifyCodeField")
                }

                Text("离线演示不会真正发短信，任意满足位数即可完成。")
                    .font(.system(size: DS.TypeScale.caption))
                    .foregroundStyle(Color.dsTextSecondary)
            }
        }
    }
}

/// Visually clear, always-tappable field chrome (avoids pale “disabled” look).
private struct VerifyLabeledField<Content: View>: View {
    let title: String
    var isFocused: Bool
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xxs) {
            Text(title)
                .font(.system(size: DS.TypeScale.caption, weight: .medium))
                .foregroundStyle(Color.dsTextSecondary)
            content
                .font(.system(size: DS.TypeScale.body))
                .foregroundStyle(Color.dsTextPrimary)
                .padding(.horizontal, DS.Space.md)
                .frame(minHeight: DS.ControlHeight.lg, alignment: .center)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.dsSurfaceElevated, in: RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                        .stroke(
                            isFocused ? Color.dsPrimary.opacity(0.55) : Color.dsBorder.opacity(0.9),
                            lineWidth: isFocused ? DS.Stroke.regular : DS.Stroke.hairline
                        )
                }
                .contentShape(Rectangle())
        }
    }
}

struct StepTitle: View {
    let symbol: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Image(systemName: symbol)
                .font(.system(size: 26))
                .foregroundStyle(Color.dsPrimary)
            Text(title)
                .font(.system(size: DS.TypeScale.title - 2, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            Text(subtitle)
                .font(.system(size: DS.TypeScale.callout))
                .foregroundStyle(Color.dsTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
