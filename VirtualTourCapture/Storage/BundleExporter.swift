import ARKit
import Foundation
import UIKit

struct ExportSummary {
    let stationCount: Int
    let frameCount: Int
    let zipURL: URL
    let zipSizeBytes: Int64
}

enum ExportError: LocalizedError {
    case zipFailed
    case noStations

    var errorDescription: String? {
        switch self {
        case .zipFailed: return "Не удалось создать zip-архив"
        case .noStations: return "В проекте нет ни одной станции"
        }
    }
}

/// Сборка бандла `tour_<uuid>/` (§3.2) и упаковка в zip.
/// Формат бандла — контракт с сервером; загрузка на сервер подключится позже
/// поверх того же экспорта.
enum BundleExporter {
    static func export(project: Project) async throws -> ExportSummary {
        guard !project.stations.isEmpty else { throw ExportError.noStations }
        let device = await deviceInfo()
        return try await Task.detached(priority: .userInitiated) {
            try buildAndZip(project: project, device: device)
        }.value
    }

    // MARK: - Сборка

    private static func buildAndZip(project: Project, device: ManifestDevice) throws -> ExportSummary {
        let fm = FileManager.default
        let bundleName = "tour_\(project.id.uuidString.lowercased())"
        let workDir = fm.temporaryDirectory.appendingPathComponent("export", isDirectory: true)
        let bundleRoot = workDir.appendingPathComponent(bundleName, isDirectory: true)

        try? fm.removeItem(at: workDir)
        try fm.createDirectory(at: bundleRoot, withIntermediateDirectories: true)

        // Станции: station.json пишем свежий, кадры хардлинкуем из живой директории
        let stationsRoot = bundleRoot.appendingPathComponent("stations", isDirectory: true)
        for station in project.stations {
            let stationDir = stationsRoot.appendingPathComponent(station.directoryName, isDirectory: true)
            try fm.createDirectory(at: stationDir, withIntermediateDirectories: true)
            let stationData = try ProjectStore.encoder.encode(station)
            try stationData.write(to: stationDir.appendingPathComponent("station.json"))

            let liveFrames = ProjectStore.framesDirectory(projectID: project.id,
                                                          stationIndex: station.index)
            if fm.fileExists(atPath: liveFrames.path) {
                try linkOrCopy(from: liveFrames,
                               to: stationDir.appendingPathComponent("frames", isDirectory: true))
            }

            let livePanorama = ProjectStore.panoramaURL(projectID: project.id,
                                                        stationIndex: station.index)
            if fm.fileExists(atPath: livePanorama.path) {
                try linkOrCopy(from: livePanorama,
                               to: stationDir.appendingPathComponent("panorama.jpg"))
            }
        }

        // Комната
        let liveRoom = ProjectStore.roomDirectory(projectID: project.id)
        var roomInfo: Manifest.RoomInfo?
        if fm.fileExists(atPath: liveRoom.appendingPathComponent("room.usdz").path) {
            try linkOrCopy(from: liveRoom, to: bundleRoot.appendingPathComponent("room", isDirectory: true))
            roomInfo = Manifest.RoomInfo(usdz: "room/room.usdz", json: "room/room.json",
                                         preview: "room/room_preview.png")
        }

        // Манифест + README
        let manifest = makeManifest(project: project, device: device, room: roomInfo)
        let manifestData = try ProjectStore.encoder.encode(manifest)
        try manifestData.write(to: bundleRoot.appendingPathComponent("manifest.json"))
        try Self.readme.data(using: .utf8)?
            .write(to: bundleRoot.appendingPathComponent("README.txt"))

        // Zip
        let zipURL = workDir.appendingPathComponent("\(bundleName).zip")
        try zipDirectory(at: bundleRoot, to: zipURL)

        let attributes = try? fm.attributesOfItem(atPath: zipURL.path)
        let zipSize = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
        return ExportSummary(stationCount: project.stations.count,
                             frameCount: project.frameCount,
                             zipURL: zipURL,
                             zipSizeBytes: zipSize)
    }

    private static func linkOrCopy(from source: URL, to destination: URL) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: destination)
        do {
            try fm.linkItem(at: source, to: destination)
        } catch {
            try fm.copyItem(at: source, to: destination)
        }
    }

    private static func zipDirectory(at sourceURL: URL, to destinationURL: URL) throws {
        var coordinatorError: NSError?
        var copyError: Error?
        var succeeded = false
        NSFileCoordinator().coordinate(readingItemAt: sourceURL,
                                       options: .forUploading,
                                       error: &coordinatorError) { zippedURL in
            do {
                try? FileManager.default.removeItem(at: destinationURL)
                try FileManager.default.copyItem(at: zippedURL, to: destinationURL)
                succeeded = true
            } catch {
                copyError = error
            }
        }
        if let coordinatorError { throw coordinatorError }
        if let copyError { throw copyError }
        if !succeeded { throw ExportError.zipFailed }
    }

    // MARK: - Манифест

    struct ManifestDevice: Encodable, Sendable {
        let model: String
        let osVersion: String
        let appVersion: String
        let hasLiDAR: Bool
    }

    private struct Manifest: Encodable {
        struct StationInfo: Encodable {
            let id: String
            let index: Int
            let roomLabel: String
            let worldPosition: [Float]
            let frameCount: Int
            let coveragePercent: Float
            let path: String
            let coordinateSpaceId: String
        }
        struct InterruptionInfo: Encodable {
            let at: Date
            let durationSeconds: Double
            let relocalized: Bool
        }
        struct SpaceInfo: Encodable {
            let id: String
            let startedAt: Date
        }
        struct RoomInfo: Encodable {
            let usdz: String
            let json: String
            let preview: String
        }

        let schemaVersion: Int
        let projectId: String
        let title: String
        let address: String
        let notes: String
        let createdAt: Date
        let device: ManifestDevice
        let worldCoordinateSpace: String
        let coordinateSpaces: [SpaceInfo]
        let trackingInterruptions: [InterruptionInfo]
        let stations: [StationInfo]
        let room: RoomInfo?
    }

    private static func makeManifest(project: Project,
                                     device: ManifestDevice,
                                     room: Manifest.RoomInfo?) -> Manifest {
        Manifest(
            schemaVersion: 1,
            projectId: project.id.uuidString.lowercased(),
            title: project.title,
            address: project.address,
            notes: project.notes,
            createdAt: project.createdAt,
            device: device,
            worldCoordinateSpace: "arkit_gravity_aligned",
            coordinateSpaces: project.coordinateSpaces.map {
                .init(id: $0.id.uuidString.lowercased(), startedAt: $0.startedAt)
            },
            trackingInterruptions: project.trackingInterruptions.map {
                .init(at: $0.at, durationSeconds: $0.durationSeconds, relocalized: $0.relocalized)
            },
            stations: project.stations.map { station in
                .init(id: station.id.uuidString.lowercased(),
                      index: station.index,
                      roomLabel: station.roomLabel,
                      worldPosition: [station.worldPosition.x,
                                      station.worldPosition.y,
                                      station.worldPosition.z],
                      frameCount: station.frames.count,
                      coveragePercent: station.coveragePercent,
                      path: "stations/\(station.directoryName)",
                      coordinateSpaceId: station.coordinateSpaceId.uuidString.lowercased())
            },
            room: room)
    }

    @MainActor
    private static func deviceInfo() -> ManifestDevice {
        var systemInfo = utsname()
        uname(&systemInfo)
        let model = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) }
        }
        let appVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.1.0"
        return ManifestDevice(model: model,
                              osVersion: UIDevice.current.systemVersion,
                              appVersion: appVersion,
                              hasLiDAR: ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh))
    }

    private static let readme = """
    VirtualTourCapture bundle (schemaVersion 1)

    Coordinate conventions
    ----------------------
    - Right-handed coordinate system, -Z forward, +Y up (ARKit standard).
    - World space is gravity-aligned; origin is where the AR session started.
    - Matrices are column-major, as in simd_float4x4.
      transform: 4x4 camera-to-world pose of each frame.
      intrinsics: 3x3 pinhole matrix (fx, fy, cx, cy) valid for imageResolution
      of the SAME frame (video in Debug test mode, high-res in Release).
    - All lengths in meters, angles in radians.
    - Frame timestamps are seconds since AR session start (ARFrame.timestamp);
      absolute createdAt is in manifest.json.
    - Images are stored in the sensor (landscape) orientation; poses and
      intrinsics correspond to that orientation.
    - Stations sharing the same coordinateSpaceId live in one continuous AR
      world space. Different coordinateSpaceId means tracking was lost or the
      session was restarted: relative placement across spaces is NOT reliable.

    Layout
    ------
    manifest.json            project metadata + index
    room/room.usdz           RoomPlan 3D model
    room/room.json           walls/doors/windows/openings/objects (transforms 4x4 column-major)
    room/room_preview.png    top-down debug render with station positions
    stations/station_NN/station.json   station metadata + per-frame poses
    stations/station_NN/frames/*.heic  captured frames
    stations/station_NN/panorama.jpg   optional equirectangular 360 panorama
    """
}
