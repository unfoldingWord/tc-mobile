import SwiftUI

// Never used on its own: a UI-testing bundle has to name a host app. The
// tests drive tC Mobile by bundle identifier instead.
@main
struct HarnessHostApp: App {
    var body: some Scene { WindowGroup { Text("tC Mobile harness host") } }
}
