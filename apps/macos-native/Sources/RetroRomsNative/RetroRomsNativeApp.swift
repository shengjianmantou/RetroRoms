import AppKit
import SwiftUI

struct CatalogResponse: Decodable { let observations: [CatalogItem] }
struct CatalogItem: Decodable, Identifiable, Hashable {
  let id: String; let title: String; let languages: [String]; let regions: [String]
  let system: String; let seriesKey: String; let preferred: Bool; let virtualPath: String
  let sha256: String; let artwork: String?
}

enum CatalogView { case grid, list }

@main struct RetroRomsNativeApp: App {
  @StateObject private var model = LibraryModel()
  var body: some Scene { WindowGroup { ContentView().environmentObject(model).frame(minWidth: 960, minHeight: 650) } }
}

struct ContentView: View {
  @EnvironmentObject private var model: LibraryModel
  @State private var query = ""
  @State private var showArtworkKey = false
  @State private var artworkKey = ""
  private var filtered: [CatalogItem] { model.items.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.system.localizedCaseInsensitiveContains(query) } }
  var body: some View {
    NavigationSplitView {
      VStack(alignment: .leading, spacing: 14) {
        Text("RetroRoms").font(.title.bold())
        Text("Native library curator").foregroundStyle(.secondary)
        Divider()
        Button("Choose ROM folders…") { model.chooseSources() }
        Text(model.sourcePaths.isEmpty ? "No source folders" : model.sourcePaths.joined(separator: "\n")).font(.caption).foregroundStyle(.secondary).lineLimit(4)
        Text("Choose an export folder only when you click Export selected.").font(.caption).foregroundStyle(.secondary)
        Button(model.isScanning ? "Scanning…" : "Rescan library") { Task { await model.scan() } }.disabled(model.isScanning || model.sourcePaths.isEmpty)
        Divider()
        Button("Artwork settings…") { showArtworkKey = true }.disabled(model.catalogURL == nil)
        Text("Source folders are read-only.").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Text(model.status).font(.caption).foregroundStyle(.secondary)
      }.padding(18).frame(minWidth: 250)
    } detail: {
      VStack(spacing: 0) {
        HStack {
          Text("Game catalog").font(.title2.bold())
          Text("\(filtered.count) games · \(model.selected.count) selected").foregroundStyle(.secondary)
          Spacer()
          Picker("View", selection: $model.view) { Text("Grid").tag(CatalogView.grid); Text("List").tag(CatalogView.list) }.pickerStyle(.segmented).frame(width: 135)
          Button("Select all") { model.selected = Set(model.items.map(\.id)) }.disabled(model.items.isEmpty)
          Button("Clear") { model.selected.removeAll() }.disabled(model.selected.isEmpty)
          Button("Scrape artwork") { Task { await model.scrapeArtwork() } }.disabled(model.selected.isEmpty)
          Button("Export selected") { Task { await model.exportSelected() } }.disabled(model.selected.isEmpty)
        }.padding()
        Divider()
        TextField("Filter games, systems…", text: $query).textFieldStyle(.roundedBorder).padding()
        if model.isLoading { Spacer(); ProgressView("Loading catalog…"); Spacer() }
        else if model.items.isEmpty { Spacer(); VStack(spacing: 10) { Image(systemName: "tray").font(.largeTitle); Text("No catalog loaded").font(.title3); Text("Choose folders and scan to begin.").foregroundStyle(.secondary) }; Spacer() }
        else if model.view == .grid { grid(filtered) } else { list(filtered) }
      }
    }.sheet(isPresented: $showArtworkKey) {
      VStack(alignment: .leading, spacing: 16) {
        Text("TheGamesDB artwork").font(.title2.bold())
        Text("Paste your API key. It stays in this processed library on this Mac.").foregroundStyle(.secondary)
        SecureField("TheGamesDB API key", text: $artworkKey).textFieldStyle(.roundedBorder)
        HStack { Spacer(); Button("Cancel") { showArtworkKey = false }; Button("Save") { Task { await model.saveArtworkKey(artworkKey); artworkKey = ""; showArtworkKey = false } }.disabled(artworkKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
      }.padding(24).frame(width: 430)
    }
  }
  @ViewBuilder private func grid(_ games: [CatalogItem]) -> some View {
    ScrollView { LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 14)], spacing: 14) { ForEach(games) { game in GameCard(game: game, selected: model.selected.contains(game.id)) { model.toggle(game.id) } } }.padding() }
  }
  @ViewBuilder private func list(_ games: [CatalogItem]) -> some View {
    List(games, selection: Binding(get: { model.selected }, set: { model.selected = $0 })) { game in
      HStack { AsyncImage(url: model.artworkURL(game)) { image in image.resizable().scaledToFill() } placeholder: { Color.indigo.opacity(0.35) }.frame(width: 74, height: 74).clipShape(RoundedRectangle(cornerRadius: 8)); VStack(alignment: .leading) { Text(game.title).font(.headline); Text("\(game.system) · \(game.regions.joined(separator: ", "))").foregroundStyle(.secondary); Text(game.virtualPath).font(.caption).foregroundStyle(.secondary).lineLimit(1) }; Spacer(); if game.preferred { Text("Preferred").font(.caption).padding(5).background(.tint.opacity(0.2), in: Capsule()) } }
    }.listStyle(.inset)
  }
}

struct GameCard: View {
  let game: CatalogItem; let selected: Bool; let toggle: () -> Void
  @EnvironmentObject private var model: LibraryModel
  var body: some View { Button(action: toggle) { VStack(alignment: .leading, spacing: 8) { AsyncImage(url: model.artworkURL(game)) { image in image.resizable().scaledToFill() } placeholder: { LinearGradient(colors: [.indigo, .teal], startPoint: .topLeading, endPoint: .bottomTrailing) }.frame(height: 150).clipped(); Text(game.title).font(.headline).lineLimit(2); Text("\(game.system) · \(game.regions.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary).lineLimit(1); HStack { if game.preferred { Text("Preferred").font(.caption2).padding(4).background(.tint.opacity(0.2), in: Capsule()) }; Spacer(); Image(systemName: selected ? "checkmark.circle.fill" : "circle") } }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(selected ? Color.accentColor.opacity(0.18) : Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Color.accentColor : Color.secondary.opacity(0.2))) }.buttonStyle(.plain) }
}

@MainActor final class LibraryModel: ObservableObject {
  @Published var sourcePaths: [String] = []; @Published var processedPath = ""; @Published var items: [CatalogItem] = []
  @Published var selected = Set<String>(); @Published var view = CatalogView.grid; @Published var status = "Choose your ROM folders to begin."
  @Published var isScanning = false; @Published var isLoading = false
  var catalogURL: URL?; private var server: Process?; private let port = 4189
  func chooseSources() { let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = true; if panel.runModal() == .OK { sourcePaths = panel.urls.map(\.path); processedPath = ""; Task { await scan() } } }
  private func chooseExportDestination() -> Bool { let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true; panel.message = "Choose the processed RetroRoms library folder"; guard panel.runModal() == .OK, let path = panel.url?.path else { return false }; processedPath = path; return true }
  func toggle(_ id: String) { if selected.contains(id) { selected.remove(id) } else { selected.insert(id) } }
  func artworkURL(_ item: CatalogItem) -> URL? { guard item.artwork != nil else { return nil }; return URL(string: "http://127.0.0.1:\(port)/api/artwork/\(item.sha256)") }
  func scan() async { guard let root = runtimeRoot() else { status = "Could not locate the RetroRoms runtime."; return }; isScanning = true; defer { isScanning = false }; let catalogRoot = processedPath.isEmpty ? workingCatalogPath() : processedPath; status = "Scanning source folders safely…"; let args = ["node", root.appendingPathComponent("apps/cli/src/main.ts").path] + sourcePaths.flatMap { ["--source", $0] } + ["--processed", catalogRoot]; do { _ = try await run("/usr/bin/env", args); catalogURL = URL(fileURLWithPath: catalogRoot).appendingPathComponent(".rom-curator/catalog.sqlite"); try await startServer(root); await reload(); status = "Scan complete: \(items.count) games. Select games, then choose Scrape covers." } catch { status = "Scan failed: \(error.localizedDescription)" } }
  func reload() async { isLoading = true; defer { isLoading = false }; do { let data = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(port)/api/observations")!).0; items = try JSONDecoder().decode(CatalogResponse.self, from: data).observations; selected.formIntersection(Set(items.map(\.id))) } catch { status = "Catalog error: \(error.localizedDescription)" } }
  func saveArtworkKey(_ key: String) async { await post("/api/artwork/settings", value: ["theGamesDbApiKey": key]); status = "Artwork key saved locally." }
  func scrapeArtwork() async { status = "Scraping artwork…"; await post("/api/artwork/scrape", value: ["ids": Array(selected)]); await reload(); status = "Artwork scrape finished." }
  func exportSelected() async { let selectedHashes = Set(items.filter { selected.contains($0.id) }.map(\.sha256)); if processedPath.isEmpty && !chooseExportDestination() { return }; status = "Preparing export library…"; await scan(); selected = Set(items.filter { selectedHashes.contains($0.sha256) }.map(\.id)); guard !selected.isEmpty else { status = "The selected games were not found after preparing the export library."; return }; status = "Exporting selected games…"; await post("/api/export", value: ["ids": Array(selected), "policy": "auto", "overwriteConflicts": false]); status = "Export finished. Source folders were not changed." }
  private func post(_ endpoint: String, value: [String: Any]) async { guard let url = URL(string: "http://127.0.0.1:\(port)\(endpoint)"), let data = try? JSONSerialization.data(withJSONObject: value) else { return }; var request = URLRequest(url: url); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = data; _ = try? await URLSession.shared.data(for: request) }
  private func startServer(_ root: URL) async throws { server?.terminate(); let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/env"); task.arguments = ["node", root.appendingPathComponent("packages/ui/src/server.ts").path, "--library", catalogURL!.path, "--port", "\(port)"]; try task.run(); server = task; try await Task.sleep(for: .milliseconds(350)) }
  private func workingCatalogPath() -> String { let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("RetroRoms/working-library", isDirectory: true); try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true); return base.path }
  private func runtimeRoot() -> URL? { if let custom = ProcessInfo.processInfo.environment["RETROROMS_HOME"] { return URL(fileURLWithPath: custom) }; var candidate = URL(fileURLWithPath: FileManager.default.currentDirectoryPath); for _ in 0..<5 { if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("package.json").path) { return candidate }; candidate.deleteLastPathComponent() }; return Bundle.main.resourceURL }
  private func run(_ executable: String, _ arguments: [String]) async throws -> String { let task = Process(); let output = Pipe(); task.executableURL = URL(fileURLWithPath: executable); task.arguments = arguments; task.standardOutput = output; task.standardError = output; try task.run(); task.waitUntilExit(); let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self); guard task.terminationStatus == 0 || task.terminationStatus == 2 else { throw NSError(domain: "RetroRoms", code: Int(task.terminationStatus), userInfo: [NSLocalizedDescriptionKey: text]) }; return text }
}
