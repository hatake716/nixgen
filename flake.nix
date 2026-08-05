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
          packages = with pkgs; [ python3 brotli curl sqlite ];
          shellHook = ''
            echo "nixgen dev shell"
            echo "  ./build/fetch-data.sh          download channel metadata"
            echo "  python3 build/build_index.py   build the search index"
            echo "  python3 build/server.py        start the app"
          '';
        };
      });

      packages = forAll (pkgs: {
        default = pkgs.writeShellApplication {
          name = "nixgen";
          runtimeInputs = with pkgs; [ python3 brotli curl ];
          text = ''
            # Code lives in the nix store and is read-only; only the index is
            # kept in the user's data directory.
            src=${./build}
            data="''${NIXGEN_DATA:-''${XDG_DATA_HOME:-$HOME/.local/share}/nixgen}"
            channel="''${NIXGEN_CHANNEL:-nixos-26.05}"
            mkdir -p "$data"

            if [ ! -f "$data/nixgen.sqlite" ]; then
              echo "first run: building the $channel index (a few minutes)"
              NIXGEN_DATA="$data" bash "$src/fetch-data.sh" "$channel"
              python3 "$src/build_index.py" --data "$data" --channel "$channel"
              rm -f "$data/options.json" "$data/packages.json"
            fi

            exec python3 "$src/server.py" --db "$data/nixgen.sqlite" "$@"
          '';
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
