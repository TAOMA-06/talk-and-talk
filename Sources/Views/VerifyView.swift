import SwiftUI

private enum VerifyField: Hashable {
    case name, age, phone, code
}

struct VerifyView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: VerifyField?

    @State private var step = 0
    @State private var name = "小楷"
    @State private var age = "22"
    @State private var phone = "18300000012"
    @State private var code = "0626"
    @State private var faceScanComplete = false

    private var canContinue: Bool {
        switch step {
        case 0: Int(age).map { $0 >= 18 } == true && !name.isEmpty
        case 1: faceScanComplete
        default: phone.count >= 11 && code.count >= 4
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                VerifyProgress(step: step)
                currentStep
                DSPrimaryButton(
                    title: step == 2 ? "完成模拟认证" : "下一步",
                    systemImage: "arrow.right",
                    isEnabled: canContinue,
                    action: advance
                )
                if step > 0 {
                    DSSecondaryButton(title: "上一步", action: goBack)
                }
                Button(action: openSafetyCenter) {
                    HStack {
                        Text("了解完整安全体系")
                        Image(systemName: "arrow.right")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.dsPrimary)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DS.Space.lg)
            .padding(.top, DS.Space.md)
            .padding(.bottom, DS.Space.xxxl)
        }
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
            store.verifyUser(name: name, phone: phone)
            dismiss()
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

    var body: some View {
        SoftCard {
            HStack(spacing: DS.Space.sm) {
                ForEach(0..<3, id: \.self) { item in
                    Capsule()
                        .fill(item <= step ? Color.dsPrimary : Color.dsBorder)
                        .frame(height: 4)
                }
            }
        }
    }
}

private struct IdentityStep: View {
    @Binding var name: String
    @Binding var age: String
    var focusedField: FocusState<VerifyField?>.Binding

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                StepTitle(symbol: "person.text.rectangle", title: "确认 18+ 身份", subtitle: "演示版只在本地修改状态，不会提交真实证件。")
                verifyTextField(placeholder: "姓名", text: $name, field: .name)
                verifyTextField(placeholder: "年龄", text: $age, field: .age, keyboard: .numberPad)
                StatusPill(
                    text: Int(age).map { $0 >= 18 } == true ? "年龄符合" : "需年满18岁",
                    symbol: "18.circle",
                    color: Int(age).map { $0 >= 18 } == true ? Color.dsSuccess : Color.dsWarning
                )
            }
        }
    }

    private func verifyTextField(
        placeholder: String,
        text: Binding<String>,
        field: VerifyField,
        keyboard: UIKeyboardType = .default
    ) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(keyboard)
            .textInputAutocapitalization(field == .name ? .words : .never)
            .autocorrectionDisabled()
            .focused(focusedField, equals: field)
            .font(.system(size: 15))
            .padding(.horizontal, DS.Space.md)
            .padding(.vertical, DS.Space.md)
            .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                    .stroke(Color.dsBorder, lineWidth: 1)
            }
    }
}

private struct FaceStep: View {
    @Binding var isComplete: Bool

    var body: some View {
        SoftCard {
            VStack(spacing: DS.Space.lg) {
                StepTitle(symbol: "faceid", title: "模拟人脸核验", subtitle: "点击下方区域即可完成模拟活体检测。")
                Button {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { isComplete = true }
                } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: DS.Radius.md, style: .continuous)
                            .stroke(style: StrokeStyle(lineWidth: 1, dash: [6]))
                            .foregroundStyle(isComplete ? Color.dsSuccess : Color.dsBorder)
                            .frame(height: 200)
                        VStack(spacing: DS.Space.md) {
                            Image(systemName: isComplete ? "checkmark.seal.fill" : "faceid")
                                .font(.system(size: 48, weight: .regular))
                                .foregroundStyle(isComplete ? Color.dsSuccess : Color.dsTextPrimary)
                            Text(isComplete ? "活体检测已通过" : "点击开始模拟检测")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Color.dsTextPrimary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
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
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                StepTitle(symbol: "iphone.gen3", title: "绑定手机号", subtitle: "验证码为演示值，可直接完成。")
                verifyTextField(placeholder: "手机号", text: $phone, field: .phone, keyboard: .phonePad)
                HStack(spacing: DS.Space.sm) {
                    verifyTextField(placeholder: "验证码", text: $code, field: .code, keyboard: .numberPad)
                    Button("重新发送") {}
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)
                        .frame(minWidth: 72)
                }
            }
        }
    }

    private func verifyTextField(
        placeholder: String,
        text: Binding<String>,
        field: VerifyField,
        keyboard: UIKeyboardType
    ) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(keyboard)
            .autocorrectionDisabled()
            .focused(focusedField, equals: field)
            .font(.system(size: 15))
            .padding(.horizontal, DS.Space.md)
            .padding(.vertical, DS.Space.md)
            .background(Color.dsBackground, in: RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: DS.Radius.sm, style: .continuous)
                    .stroke(Color.dsBorder, lineWidth: 1)
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
                .font(.system(size: 28))
                .foregroundStyle(Color.dsPrimary)
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color.dsTextPrimary)
            Text(subtitle)
                .font(.system(size: 13))
                .foregroundStyle(Color.dsTextSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
