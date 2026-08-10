import Foundation
import simd

/// Одна точка съёмки — оператор стоит и вращается вокруг себя
struct Station: Codable, Identifiable {
    let id: UUID
    var index: Int               // порядковый номер, 1..N
    var roomLabel: String        // "Гостиная", заполняется оператором
    var worldPosition: SIMD3<Float>   // где стоял оператор, в world-координатах ARKit
    var frames: [CapturedFrame]
    var coveragePercent: Float   // 0...1
    var startedAt: Date
    var finishedAt: Date?
    var coordinateSpaceId: UUID
    var lockedISO: Float?
    var lockedExposureDuration: Double?

    var directoryName: String { String(format: "station_%02d", index) }
}
