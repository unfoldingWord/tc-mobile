# Fastlane is the iOS TestFlight pipeline's only Ruby dependency (#262).
# It runs on the macOS CI runner (.github/workflows/ios-testflight.yml) and on
# a maintainer's Mac; it is never installed by the JS toolchain. CocoaPods is
# deliberately absent — Capacitor 8 uses Swift Package Manager, so there are no
# Pods to install (docs/native/README.md §3).
source "https://rubygems.org"

gem "fastlane", "~> 2.226"
