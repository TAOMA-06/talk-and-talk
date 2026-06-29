import SwiftUI

struct VerifyView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var name = "小桃"
    @State private var age = "22"
    @State private var phone = "13888888826"
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
        AppScaffold(title: "18+ 实名认证", spacing: DS.Space.lg, bottomPadding: DS.Space.xl) {
            VerifyProgress(step: step)
            currentStep
            DSPrimaryButton(title: step == 2 ? "完成模拟认证" : "下一步", systemImage: "arrow.right", isEnabled: canContinue) {
                if step < 2 {
                    withAnimation(.easeOut(duration: DS.Motion.fast)) { step += 1 }
                } else {
                    store.verifyUser(name: name, phone: phone)
                    dismiss()
                }
            }
            Button {
                store.navigate(.safetyCenter)
            } label: {
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
    }

    @ViewBuilder
    private var currentStep: some View {
        switch step {
        case 0:
            IdentityStep(name: $name, age: $age)
        case 1:
            FaceStep(isComplete: $faceScanComplete)
        default:
            PhoneStep(phone: $phone, code: $code)
        }
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

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                StepTitle(symbol: "person.text.rectangle", title: "确认 18+ 身份", subtitle: "演示版只在本地修改状态，不会提交真实证件。")
                DSInputField(placeholder: "姓名", text: $name)
                DSInputField(placeholder: "年龄", text: $age, keyboardType: .numberPad)
                StatusPill(
                    text: Int(age).map { $0 >= 18 } == true ? "年龄符合" : "需年满18岁",
                    symbol: "18.circle",
                    color: Int(age).map { $0 >= 18 } == true ? Color.dsSuccess : Color.dsWarning
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
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct PhoneStep: View {
    @Binding var phone: String
    @Binding var code: String

    var body: some View {
        SoftCard {
            VStack(alignment: .leading, spacing: DS.Space.lg) {
                StepTitle(symbol: "iphone.gen3", title: "绑定手机号", subtitle: "验证码为演示值，可直接完成。")
                DSInputField(placeholder: "手机号", text: $phone, keyboardType: .phonePad)
                HStack(spacing: DS.Space.sm) {
                    DSInputField(placeholder: "验证码", text: $code, keyboardType: .numberPad)
                    Button("重新发送") {}
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.dsPrimary)
                }
            }
        }
    }
}

private struct StepTitle: View {
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
