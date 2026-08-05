"""Starter files that wire a system up around the module nixgen produces.

Every line in configuration.nix is wrapped in `lib.mkDefault`. Without that,
setting the same option here and in generated.nix gives you

    error: The option `networking.hostName' has conflicting definition values

which is a miserable first experience. mkDefault lowers the priority of these
definitions so whatever you set in nixgen simply wins.

The file is assembled block by block rather than from one template, because
every block can be switched off. `defines()` then reports exactly the option
paths that were emitted, so the UI can flag the ones generated.nix also sets.
"""

import re

SYSTEMS = ["x86_64-linux", "aarch64-linux"]
BOOTLOADERS = ["systemd-boot", "grub", "none"]

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")
_STATE_VERSION = re.compile(r"\d\d\.\d\d")
_DEVICE = re.compile(r"[A-Za-z0-9/._-]+")


def _safe(value, fallback, pattern=_IDENT):
    value = (value or "").strip()
    return value if pattern.fullmatch(value) else fallback


def _channel_version(channel):
    """`nixos-26.05` -> `26.05`."""
    m = _STATE_VERSION.search(channel or "")
    return m.group(0) if m else "26.05"


def _groups(raw, fallback=("wheel", "networkmanager")):
    """Comma or space separated group names, keeping only valid ones."""
    if raw is None:
        return list(fallback)
    found = [g for g in re.split(r"[,\s]+", raw.strip()) if g]
    kept = [g for g in found if _IDENT.fullmatch(g)]
    return kept


def _nix_list(items):
    return "[ " + " ".join('"%s"' % i for i in items) + " ]" if items else "[ ]"


def _flag(value, default=True):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------- blocks

def _configuration(host, user, system, state, opts):
    boot = opts["bootloader"]
    out = []
    defines = []

    out.append(f'''# configuration.nix — the hand-written half of your system.
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

''')

    if boot == "systemd-boot":
        out.append('''  # Boot loader (UEFI).
  boot.loader.systemd-boot.enable = lib.mkDefault true;
  boot.loader.efi.canTouchEfiVariables = lib.mkDefault true;
''')
        defines += ["boot.loader.systemd-boot.enable",
                    "boot.loader.efi.canTouchEfiVariables"]
    elif boot == "grub":
        out.append(f'''  # Boot loader (BIOS / legacy). `device` is the disk, not a partition.
  boot.loader.grub.enable = lib.mkDefault true;
  boot.loader.grub.device = lib.mkDefault "{opts['grub_device']}";
''')
        defines += ["boot.loader.grub.enable", "boot.loader.grub.device"]
    else:
        out.append('''  # No boot loader here — your hardware-configuration.nix or another
  # module is expected to set one.
''')

    net = ['  networking.hostName = lib.mkDefault "%s";' % host]
    defines.append("networking.hostName")
    if opts["networkmanager"]:
        net.append("  networking.networkmanager.enable = lib.mkDefault true;")
        defines.append("networking.networkmanager.enable")
    out.append("\n" + "\n".join(net) + "\n")

    if opts["make_user"]:
        out.append(f'''
  users.users.{user} = {{
    isNormalUser = lib.mkDefault true;
    extraGroups = lib.mkDefault {_nix_list(opts["groups"])};
  }};
''')
        defines += [f"users.users.{user}.isNormalUser",
                    f"users.users.{user}.extraGroups"]

    if opts["flakes"]:
        out.append('''
  # Needed before `nixos-rebuild --flake` will work.
  nix.settings.experimental-features = lib.mkDefault [ "nix-command" "flakes" ];
''')
        defines.append("nix.settings.experimental-features")

    out.append(f'''
  # The release you first installed. Do not raise it to match a newer NixOS
  # unless you have read the release notes — it exists to keep stateful data
  # readable across upgrades.
  system.stateVersion = lib.mkDefault "{state}";
}}
''')
    defines.append("system.stateVersion")

    return "".join(out), defines


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


def starter_files(host, user, system, channel, **kw):
    host = _safe(host, "nixos")
    user = _safe(user, "user")
    system = system if system in SYSTEMS else SYSTEMS[0]

    boot = kw.get("bootloader")
    opts = {
        "bootloader": boot if boot in BOOTLOADERS else "systemd-boot",
        "grub_device": _safe(kw.get("grub_device"), "/dev/sda", _DEVICE),
        "networkmanager": _flag(kw.get("networkmanager")),
        "make_user": _flag(kw.get("make_user")),
        "groups": _groups(kw.get("groups")),
        "flakes": _flag(kw.get("flakes")),
    }
    state = _safe(kw.get("state_version"), _channel_version(channel), _STATE_VERSION)

    configuration, defines = _configuration(host, user, system, state, opts)

    return {
        "configuration.nix": configuration,
        "flake.nix": FLAKE.format(host=host, channel=channel or "nixos-26.05",
                                  system=system),
        "defines": defines,
    }
