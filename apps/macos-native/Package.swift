// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "RetroRomsNative",
  platforms: [.macOS(.v13)],
  products: [.executable(name: "RetroRomsNative", targets: ["RetroRomsNative"])],
  targets: [.executableTarget(name: "RetroRomsNative")]
)
