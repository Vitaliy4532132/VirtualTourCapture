import Foundation
import simd

struct Project: Codable, Identifiable {
    let id: UUID
    var title: String            // "Квартира на Штефан чел Маре 12"
    var address: String
    var notes: String
    let createdAt: Date
    var stations: [Station]      // точки съёмки
    var roomPlanExportedAt: Date?
    var trackingInterruptions: [TrackingInterruption]
    var coordinateSpaces: [CoordinateSpaceRecord]

    init(title: String, address: String = "", notes: String = "") {
        self.id = UUID()
        self.title = title
        self.address = address
        self.notes = notes
        self.createdAt = Date()
        self.stations = []
        self.roomPlanExportedAt = nil
        self.trackingInterruptions = []
        self.coordinateSpaces = []
    }

    var frameCount: Int { stations.reduce(0) { $0 + $1.frames.count } }
}

struct TrackingInterruption: Codable {
    let at: Date
    var durationSeconds: Double
    var relocalized: Bool
}

/// Одна непрерывная AR-сессия. Если трекинг был потерян безвозвратно (или проект
/// продолжили после перезапуска приложения), станции попадают в разные пространства
/// координат — это фиксируется в манифесте.
struct CoordinateSpaceRecord: Codable, Identifiable {
    let id: UUID
    let startedAt: Date
}
