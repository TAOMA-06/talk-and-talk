import Foundation

struct APIModerationClient: Sendable {
    func moderate(text: String) async -> ModerationResult? {
        guard let apiKey = ModerationConfig.apiKey else { return nil }

        guard let url = URL(string: "https://api.openai.com/v1/moderations") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["input": text]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 8

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            return parseResponse(data)
        } catch {
            return nil
        }
    }

    private func parseResponse(_ data: Data) -> ModerationResult? {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let results = json["results"] as? [[String: Any]],
            let first = results.first
        else { return nil }

        let flagged = first["flagged"] as? Bool ?? false
        let categories = first["category_scores"] as? [String: Double] ?? [:]
        let topScore = categories.values.max() ?? 0
        let score = flagged ? max(topScore, 0.7) : topScore
        let topCategories = categories
            .sorted { $0.value > $1.value }
            .prefix(2)
            .map(\.key)

        return ModerationScoring.result(
            score: score,
            reasons: topCategories.isEmpty ? ["内容安全提醒"] : topCategories.map { "识别到：\($0)" },
            matchedRules: ["api.moderation"],
            usedAI: true
        )
    }
}
