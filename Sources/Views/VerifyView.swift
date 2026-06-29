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
        AppScaffold(title: "18+ 实名认证", spacing: 20, bottomPadding: 40) {
            VerifyProgress(step: step)
            currentStep
            PrimaryActionButton(title: step == 2 ? "完成模拟认证" : "下一步", systemImage: "arrow.right", isEnabled: canContinue) {
                if step < 2 {
                    withAnimation(.snappy) { step += 1 }
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
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.appTeal)
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
        GlassPanel(cornerRadius: 22) {
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { item in
                    Capsule()
                        .fill(item <= step ? Color.appTeal : Color.black.opacity(0.08))
                        .frame(height: 8)
                }
            }
        }
    }
}

private struct IdentityStep: View {
    @Binding var name: String
    @Binding var age: String

    var body: some View {
        GlassPanel(cornerRadius: 28, tint: Color.appTeal.opacity(0.1)) {
            VStack(alignment: .leading, spacing: 18) {
                StepTitle(symbol: "person.text.rectangle", title: "确认 18+ 身份", subtitle: "演示版只在本地修改状态，不会提交真实证件。")
                TextField("姓名", text: $name)
                    .textFieldStyle(.roundedBorder)
                TextField("年龄", text: $age)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                StatusPill(text: Int(age).map { $0 >= 18 } == true ? "年龄符合" : "需年满18岁", symbol: "18.circle", color: Int(age).map { $0 >= 18 } == true ? Color.appTeal : Color.appCoral)
            }
        }
    }
}

private struct FaceStep: View {
    @Binding var isComplete: Bool

    var body: some View {
        GlassPanel(cornerRadius: 28, tint: Color.appLilac.opacity(0.1)) {
            VStack(spacing: 20) {
                StepTitle(symbol: "faceid", title: "模拟人脸核验", subtitle: "点击下方区域即可完成模拟活体检测。")
                Button {
                    withAnimation(.snappy) { isComplete = true }
                } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(style: StrokeStyle(lineWidth: 2, dash: [8]))
                            .foregroundStyle(isComplete ? Color.appTeal : Color.appMuted)
                            .frame(height: 220)
                        VStack(spacing: 12) {
                            Image(systemName: isComplete ? "checkmark.seal.fill" : "faceid")
                                .font(.system(size: 58, weight: .semibold))
                                .foregroundStyle(isComplete ? Color.appTeal : Color.appInk)
                            Text(isComplete ? "活体检测已通过" : "点击开始模拟检测")
                                .font(.headline)
                                .foregroundStyle(Color.appInk)
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
        GlassPanel(cornerRadius: 28, tint: Color.appGold.opacity(0.1)) {
            VStack(alignment: .leading, spacing: 18) {
                StepTitle(symbol: "iphone.gen3", title: "绑定手机号", subtitle: "验证码为演示值，可直接完成。")
                TextField("手机号", text: $phone)
                    .keyboardType(.phonePad)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    TextField("验证码", text: $code)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    Button("重新发送") {}
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.appTeal)
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
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(Color.appTeal)
            Text(title)
                .font(.title2.bold())
                .foregroundStyle(Color.appInk)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Color.appMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
