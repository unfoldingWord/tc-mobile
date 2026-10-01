# Fastlane is the iOS TestFlight pipeline's only Ruby dependency (#262).
# It runs on the macOS CI runner (.github/workflows/ios-testflight.yml) and on
# a maintainer's Mac; it is never installed by the JS toolchain. CocoaPods is
# deliberately absent — Capacitor 8 uses Swift Package Manager, so there are no
# Pods to install (docs/native/README.md §3).
source "https://rubygems.org"

gem "fastlane", "~> 2.240"

# CFPropertyList 3.0.9 declares required_ruby_version < 3.2, which fails the
# frozen install on the macos-14 runner (Ruby 3.3.12) — the first TestFlight
# dispatch died there. Pin the last 3.x without that ceiling. This must live in
# the Gemfile, not only the lock: the lock is authored on pre-3.2 Ruby (which
# re-resolves 3.0.9) and Dependabot's weekly bundler digest would treat
# 3.0.8 -> 3.0.9 as a patch. xcodeproj 1.28.1 caps the line at < 4.0, so 4.x is
# not an option (see .github/dependabot.yml ignore, and docs/native/README.md §4a).
gem "CFPropertyList", "3.0.8"
