# Homebrew formula for the silo CLI (a terminal client for silo).
#
# Tap + install:
#   brew tap amitray007/silo https://github.com/amitray007/silo
#   brew install amitray007/silo/silo
#
# The `url` + `sha256` below point at the `silo-cli-<version>.tgz` asset on the
# matching `cli-v<version>` GitHub Release. They are UPDATED AUTOMATICALLY by
# the release workflow (.github/workflows/release.yml) on every `cli-v*` release
# — do not hand-edit the version/url/sha256 (the workflow rewrites them).
#
# The CLI has ZERO runtime npm dependencies (it uses only Node built-ins), so
# the formula just needs Node present + the tarball's dist/ on disk; `silo` is a
# `#!/usr/bin/env node` script symlinked onto the PATH.
class Silo < Formula
  desc "Terminal client for silo — capture, search, list, and open your links"
  homepage "https://github.com/amitray007/silo"
  # RELEASE-MANAGED: version/url/sha256 are rewritten by the release workflow.
  version "0.1.0"
  url "https://github.com/amitray007/silo/releases/download/cli-v0.1.0/silo-cli-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node" # the CLI runs on Node (>=24); no other runtime deps

  def install
    # The tarball contains dist/ + package.json (+ LICENSE). Install everything
    # into libexec, then expose a `silo` launcher on the PATH that runs the
    # entry with the Homebrew-managed node (dist/main.js has a `#!/usr/bin/env
    # node` shebang, but a wrapper makes the node dependency explicit + robust).
    libexec.install Dir["*"]
    (bin/"silo").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/main.js" "$@"
    SH
    chmod 0555, bin/"silo"
  end

  test do
    # The bin runs and prints its help without a server (help is offline).
    assert_match "silo", shell_output("#{bin}/silo --help")
  end
end
