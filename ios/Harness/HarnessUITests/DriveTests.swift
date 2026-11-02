import XCTest

/// One shell command per run: the action comes from TEST_RUNNER_HARNESS_* env vars.
final class DriveTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    func testDrive() throws {
        let bundle = env["HARNESS_BUNDLE"] ?? "org.unfoldingword.tcmobile"
        let app = XCUIApplication(bundleIdentifier: bundle)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let label = env["HARNESS_LABEL"] ?? ""
        let timeout = Double(env["HARNESS_TIMEOUT"] ?? "") ?? 10

        let action = env["HARNESS_ACTION"] ?? ""
        // The runner takes the foreground on start; bring tC Mobile back unless the action is Home.
        if action != "home" { app.activate() }
        switch action {
        case "home":
            XCUIDevice.shared.press(.home)
        case "activate":
            app.activate()
        case "tap":
            // An alert or sheet may belong to the app or to SpringBoard; try the app first.
            let target = [app, springboard]
                .map { $0.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch }
                .first { $0.waitForExistence(timeout: timeout / 2) }
            let element = try XCTUnwrap(target, "no element labelled \(label)")
            element.tap()
        case "describe":
            print("HARNESS_STATE \(app.state.rawValue)")
            print("HARNESS_TREE_BEGIN\n\(app.debugDescription)\nHARNESS_TREE_END")
        default:
            XCTFail("HARNESS_ACTION must be home, activate, tap or describe")
        }
    }
}
