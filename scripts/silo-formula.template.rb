# Homebrew formula TEMPLATE for the silo CLI.
#
# This is a template — the release pipeline (`.github/workflows/release.yml` on
# a `cli-v*` release) renders it (substituting {{VERSION}} / {{URL}} / {{SHA256}})
# and pushes the result to `amitray007/homebrew-tap` as `Formula/silo.rb`. Do
# NOT hand-edit the rendered formula in the tap — this template is the source.
#
# Install (once released):
#   brew tap amitray007/tap
#   brew install amitray007/tap/silo
#
# The tarball is hosted on the PUBLIC homebrew-tap's own release (mirroring the
# orpheus pattern), so `brew install` works without auth regardless of whether
# the silo source repo is public or private. (The same tarball is also attached
# to silo's own cli-v* release for direct downloaders.) The CLI has ZERO runtime
# npm deps (Node built-ins only) — the formula just needs Node + the tarball's
# dist/ on disk; `silo` is a launcher that runs the entry with Homebrew's node.
class Silo < Formula
  desc "Terminal client for silo — capture, search, list, and open your links"
  homepage "https://github.com/amitray007/silo"
  version "{{VERSION}}"
  url "{{URL}}"
  sha256 "{{SHA256}}"
  license "MIT"

  depends_on "node"

  def install
    # Tarball contains dist/ + package.json (+ LICENSE). Install into libexec,
    # then expose a `silo` launcher that runs the entry with Homebrew's node.
    libexec.install Dir["*"]
    (bin/"silo").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/main.js" "$@"
    SH
    chmod 0555, bin/"silo"
  end

  test do
    # The bin runs + prints help without a server (help is offline).
    assert_match "silo", shell_output("#{bin}/silo --help")
  end
end
