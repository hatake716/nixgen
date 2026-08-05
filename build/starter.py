"""Starter files that wire a system up around the module nixgen produces.

Everything in configuration.nix is wrapped in `lib.mkDefault`. Without that,
setting the same option here and in generated.nix gives you

    error: The option `networking.hostName' has conflicting definition values

which is a miserable first experience. mkDefault lowers the priority of these
definitions so whatever you set in nixgen simply wins.
"""

import re

SYSTEMS = ["x86_64-linux", "aarch64-linux"]

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")


def _safe(value, fallback):
    value = (value or "").strip()
    return value if _IDENT.fullmatch(value) else fallback


def _channel_version(channel):
    """`nixos-26.05` -> `26.05`."""
    m = re.search(r"(\d\d\.\d\d)", channel or "")
    return m.group(1) if m else "26.05"


CONFIGURATION = '''# configuration.nix — the hand-written half of your system.
# Everything nixgen manages lives in ./generated.nix.
#
# Apply with:
#   sudo nixos-rebuild switch --flake /etc/nixos#{host}

{{ config, lib, pkgs, ... }}:

{{
  imports = [
    ./hardware-configuration.nix
    ./generated.nix
  ];

  # Every definition below uses lib.mkDefault, so anything you also set in
  # nixgen takes precedence instead of colliding with it.

  # Boot loader. This is the UEFI setup; for a BIOS machine, drop these two
  # and use boot.loader.grub.device instead.
  boot.loader.systemd-boot.enable = lib.mkDefault true;
  boot.loader.efi.canTouchEfiVariables = lib.mkDefault true;

  networking.hostName = lib.mkDefault "{host}";
  networking.networkmanager.enable = lib.mkDefault true;

  users.users.{user} = {{
    isNormalUser = lib.mkDefault true;
    extraGroups = lib.mkDefault [ "wheel" "networkmanager" ];
  }};

  # Needed before `nixos-rebuild --flake` will work.
  nix.settings.experimental-features = lib.mkDefault [ "nix-command" "flakes" ];

  # The release you first installed. Do not raise it to match a newer NixOS
  # unless you have read the release notes — it exists to keep stateful data
  # readable across upgrades.
  system.stateVersion = lib.mkDefault "{state}";
}}
'''

FLAKE = '''{{
  description = "NixOS configuration for {host}";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/{channel}";

  outputs = {{ self, nixpkgs }}: {{
    nixosConfigurations.{host} = nixpkgs.lib.nixosSystem {{
      modules = [
        {{ nixpkgs.hostPlatform = "{system}"; }}
        ./configuration.nix
      ];
    }};
  }};
}}
'''

def starter_files(host, user, system, channel):
    host = _safe(host, "nixos")
    user = _safe(user, "user")
    system = system if system in SYSTEMS else SYSTEMS[0]
    state = _channel_version(channel)

    return {
        "configuration.nix": CONFIGURATION.format(host=host, user=user, state=state),
        "flake.nix": FLAKE.format(host=host, channel=channel or "nixos-26.05", system=system),
        # Paths the starter defines. The UI flags any of these that also appear
        # in generated.nix: two lib.mkDefault definitions of the same option
        # have equal priority, and NixOS refuses to pick between them.
        "defines": [
            "boot.loader.systemd-boot.enable",
            "boot.loader.efi.canTouchEfiVariables",
            "networking.hostName",
            "networking.networkmanager.enable",
            f"users.users.{user}.isNormalUser",
            f"users.users.{user}.extraGroups",
            "nix.settings.experimental-features",
            "system.stateVersion",
        ],
    }
