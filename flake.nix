{
  description = "nixgen — a form-driven generator for NixOS configuration modules";
  # SPDX-License-Identifier: MIT

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          # nodejs is here for `node --check build/static/app.js` alone. It is
          # in the checklist and in CI, and until now the shell that is meant
          # to make the checklist runnable did not have it.
          packages = with pkgs; [ python3 brotli curl sqlite nodejs ];
          shellHook = ''
            echo "nixgen dev shell"
            echo "  ./build/fetch-data.sh          download channel metadata"
            echo "  python3 build/build_index.py   build the search index"
            echo "  python3 build/server.py        start the app"
            echo "  python3 tools/fuzz.py          renderer checks"
            echo "  python3 tools/import_check.py  importer checks"
          '';
        };
      });

      packages = forAll (pkgs:
        let
          nixgen = pkgs.writeShellApplication {
            name = "nixgen";
            # libnotify is for the first-run notice below, and only for that.
            runtimeInputs = with pkgs; [ python3 brotli curl libnotify ];
            text = ''
            # Code lives in the nix store and is read-only; only the index is
            # kept in the user's data directory.
            src=${./build}
            data="''${NIXGEN_DATA:-''${XDG_DATA_HOME:-$HOME/.local/share}/nixgen}"
            channel="''${NIXGEN_CHANNEL:-nixos-26.05}"
            mkdir -p "$data"

            if [ ! -f "$data/nixgen.sqlite" ]; then
              echo "first run: building the $channel index (a few minutes)"
              # Started from the desktop entry there is no terminal, so that
              # line goes nowhere and the icon looks dead for five minutes.
              # Best effort: notify-send is here as a runtime input, but it
              # still needs a session bus to reach anybody, so a failure is
              # not one worth stopping the launch for.
              if [ ! -t 1 ]; then
                notify-send -a nixgen "nixgen: first run" \
                  "Building the $channel index. This takes a few minutes; the browser opens when it is ready." \
                  || true
              fi
              NIXGEN_DATA="$data" bash "$src/fetch-data.sh" "$channel"
              python3 "$src/build_index.py" --data "$data" --channel "$channel"
              rm -f "$data/options.json" "$data/packages.json"
            fi

            exec python3 "$src/server.py" --db "$data/nixgen.sqlite" "$@"
          '';
          };

          # Generated at build time rather than kept as files, so `mark.py`
          # stays the only place the mark comes from — the same reason the two
          # pages paste its output rather than fetching a copy.
          #
          # Two renditions, for the reason the README's logo has two: the
          # artwork needs room. Rendered at 32 or 48 its arcs and small shapes
          # collapse into noise, so those sizes get the plain flake and 64 and
          # up get the artwork. A theme is allowed to disagree per size — that
          # is what the size directories are for — and GTK was checked to
          # confirm it prefers an exact-size directory over `scalable`, which
          # is what keeps the artwork out of a 24px panel slot.
          icon = pkgs.runCommand "nixgen-icon" {
            nativeBuildInputs = [ pkgs.librsvg ];
          } ''
            py=${pkgs.python3}/bin/python3
            $py ${./tools/mark.py} --icon > art.svg
            $py ${./tools/mark.py} --icon-small > flake.svg

            install -Dm444 art.svg \
              $out/share/icons/hicolor/scalable/apps/nixgen.svg

            render() {
              for s in $2; do
                d=$out/share/icons/hicolor/''${s}x''${s}/apps
                mkdir -p "$d"
                rsvg-convert -w "$s" -h "$s" "$1" -o "$d/nixgen.png"
              done
            }
            render flake.svg "16 22 24 32 48"
            render art.svg "64 128 256"
          '';

          # NixOS has no way to install anything from a GUI — neither GNOME
          # Software nor Discover manages system packages here — so the first
          # command cannot be removed. This removes every command after it:
          # once nixgen is in a profile or in configuration.nix, it is in the
          # application menu like anything else, and starting it opens the
          # browser by itself.
          desktopItem = pkgs.makeDesktopItem {
            name = "nixgen";
            # The name is an identifier and is not translated, for the reason
            # option paths are not: it is what the docs and the menu call it.
            desktopName = "nixgen";
            genericName = "NixOS configuration generator";
            comment = "Build a NixOS configuration in a form, and read the file it writes";
            # --app: from the menu this is an application, so it gets a
            # window without a tab strip or an address bar when a browser
            # here can do that. A terminal launch has no --app and keeps the
            # ordinary browser, where a tab is what you asked for.
            exec = "${nixgen}/bin/nixgen --app";
            icon = "nixgen";
            # The window belongs to the browser, not to this process, so
            # the desktop cannot match a startup notification to it: it would
            # spin until it gave up.
            terminal = false;
            startupNotify = false;
            # One main category only: two of them puts the entry in the menu
            # twice, which desktop-file-validate warns about. System rather
            # than Settings because this writes a file for you to apply, and
            # does not change the running system.
            categories = [ "System" ];
            keywords = [ "nix" "nixos" "configuration" "flake" ];
            # Both languages, the way every message the app writes carries
            # both. Only the prose — the name stays as it is.
            extraConfig = {
              "GenericName[ja]" = "NixOS設定ジェネレーター";
              "Comment[ja]" = "フォームからNixOSの設定を組み立て、生成されたファイルを読みます";
            };
          };
        in
        {
          default = pkgs.symlinkJoin {
            name = "nixgen";
            paths = [ nixgen icon desktopItem ];
            # symlinkJoin does not carry one over from its inputs, and without
            # it `nix run` has three bin entries to guess between.
            meta.mainProgram = "nixgen";
          };
        });

      apps = forAll (pkgs: {
        default = {
          type = "app";
          # pkgs.system is deprecated; hostPlatform.system is the current spelling.
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/nixgen";
        };
      });
    };
}
