import SwiftUI

struct VerifyView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    
    @State private var step = 1
    @State private var name = ""
    @State private var idNumber = ""
    @State private var phone = ""
    @State private var code = ""
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                ProgressBar(step: step)
                
                switch step {
                case 1:
                    IdentityVerificationStep(
                        name: $name,
                        idNumber: $idNumber
                    )
                case 2:
                    FaceRecognitionStep()
                case 3:
                    PhoneVerificationStep(
                        phone: $phone,
                        code: $code
                    )
                default:
                    EmptyView()
                }
                
                VerifySubmitButton {
                    if step < 3 {
                        step += 1
                    } else {
                        store.verifyUser()
                        dismiss()
                    }
                }
            }
            .padding()
        }
        .navigationTitle("实名认证")
    }
}

struct ProgressBar: View {
    let step: Int
    
    var body: some View {
        HStack(spacing: 8) {
            ForEach(1...3, id: \.self) { s in
                RoundedRectangle(cornerRadius: 4)
                    .fill(s <= step ? Color.teal : Color.gray.opacity(0.2))
                    .frame(height: 8)
            }
        }
    }
}

struct IdentityVerificationStep: View {
    @Binding var name: String
    @Binding var idNumber: String
    
    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 12) {
                Image(systemName: "shield.checkered")
                    .font(.system(size: 48))
                    .foregroundStyle(.teal)
                
                Text("实名认证")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Text("为了平台安全，需要完成实名认证")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            
            VStack(spacing: 16) {
                LabeledContent("真实姓名") {
                    TextField("请输入真实姓名", text: $name)
                        .textFieldStyle(.roundedBorder)
                }
                
                LabeledContent("身份证号") {
                    TextField("请输入身份证号", text: $idNumber)
                        .textFieldStyle(.roundedBorder)
                }
            }
        }
    }
}

struct FaceRecognitionStep: View {
    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 12) {
                Image(systemName: "arrow.up.circle")
                    .font(.system(size: 48))
                    .foregroundStyle(.teal)
                
                Text("人脸识别")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Text("请进行人脸识别验证")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.gray.opacity(0.1))
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(style: StrokeStyle(lineWidth: 2, dash: [8]))
                            .foregroundStyle(.secondary)
                    )
                
                VStack(spacing: 12) {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 64))
                        .foregroundStyle(.secondary)
                    
                    Text("点击开始人脸识别")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct PhoneVerificationStep: View {
    @Binding var phone: String
    @Binding var code: String
    
    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 12) {
                Image(systemName: "phone")
                    .font(.system(size: 48))
                    .foregroundStyle(.teal)
                
                Text("手机验证")
                    .font(.title2)
                    .fontWeight(.bold)
                
                Text("验证您的手机号码")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            
            VStack(spacing: 16) {
                HStack(spacing: 12) {
                    TextField("请输入手机号", text: $phone)
                        .textFieldStyle(.roundedBorder)
                    
                    Button("获取验证码") {}
                        .buttonStyle(.bordered)
                        .tint(.primary)
                }
                
                LabeledContent("验证码") {
                    TextField("请输入验证码", text: $code)
                        .textFieldStyle(.roundedBorder)
                }
            }
        }
    }
}

struct VerifySubmitButton: View {
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text("下一步")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        }
        .buttonStyle(.borderedProminent)
        .tint(.primary)
    }
}
