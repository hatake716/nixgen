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

from nixgen_core import render_lines
from releases import UNSTABLE, is_revision

SYSTEMS = ["x86_64-linux", "aarch64-linux"]
BOOTLOADERS = ["systemd-boot", "grub", "none"]

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")
_STATE_VERSION = re.compile(r"\d\d\.\d\d")
_DEVICE = re.compile(r"[A-Za-z0-9/._-]+")


def _safe(value, fallback, pattern=_IDENT):
    value = (value or "").strip()
    return value if pattern.fullmatch(value) else fallback


def _channel_version(channel, release=None):
    """The NixOS version to start `system.stateVersion` at.

    `nixos-26.05` says so in its name. `nixos-unstable` does not, so the index
    records what the catalogue said `system.nixos.release` defaults to — which
    on unstable is the release being worked towards, and is what a fresh
    install would have picked for itself.
    """
    m = _STATE_VERSION.search(channel or "")
    if m:
        return m.group(0)
    m = _STATE_VERSION.search(release or "")
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

def _carried(entries, imports):
    """What an imported configuration.nix said, on its way into the one this
    writes.

    The settings the Setup tab has fields for were taken out before this: they
    are rewritten from those fields, and carrying them as well would define the
    same attribute twice in one file. What is left is everything nixgen has no
    field for, rendered by the same renderer the module uses so the quoting
    rules are the same ones.

    Plain definitions, not `lib.mkDefault`: they are the values that were
    already running on the machine, and a default is not what they were.
    """
    if not entries:
        return "", []
    lines = render_lines(entries)
    paths = [e.get("path") or ".".join(e.get("segments") or []) for e in entries]
    head = ("\n  # Carried over from the configuration.nix you read in. nixgen has\n"
            "  # no field for these, so they are copied through as they were.\n")
    return head + lines, [p for p in paths if p]


def _configuration(host, user, system, state, opts, carried="", extra_imports=()):
    boot = opts["bootloader"]
    out = []
    defines = []

    more = "".join(f"\n    {p}" for p in extra_imports)
    out.append(f'''# configuration.nix — the hand-written half of your system.
# Everything nixgen manages lives in ./generated.nix.
#
# Apply with:
#   sudo nixos-rebuild switch --flake /etc/nixos#{host}

{{ config, lib, pkgs, ... }}:

{{
  imports = [
    ./hardware-configuration.nix
    ./generated.nix{more}
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
''')
    defines.append("system.stateVersion")

    out.append(carried)
    out.append("}\n")
    return "".join(out), defines


FLAKE = '''{{
  description = "NixOS configuration for {host}";

{pin}  inputs.nixpkgs.url = "github:NixOS/nixpkgs/{ref}";

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

# Naming a commit instead of the branch is what keeps the built system and the
# option list in step, so the comment says which commit it is and where it came
# from. Those are two different claims: one is the snapshot the options were
# read from, the other is only wherever the branch happens to be today.
PINNED_INDEXED = '''  # nixpkgs, at the exact commit {channel} pointed at when nixgen built the
  # option list you filled this in from — so the system you build has those
  # options and not whatever the branch has moved to since.
  #
  # `nix flake update` cannot move a named commit. To take a newer snapshot,
  # generate this file again; to follow the branch instead, put "{channel}"
  # back in place of the commit.
'''

PINNED_HEAD = '''  # nixpkgs, at the commit {channel} points at right now. nixgen could not
  # tell which commit its option list was read from, so the options you filled
  # this in from may have come from a slightly different snapshot — the build
  # is reproducible either way, but treat that list as a guide rather than a
  # promise about this commit.
  #
  # `nix flake update` cannot move a named commit. To follow the branch
  # instead, put "{channel}" back in place of the commit.
'''

BRANCH = '''  # nixpkgs, following the {channel} branch, which is what nixgen was set to.
  # The first build takes whatever the branch holds at the time and flake.lock
  # records where it landed; `nix flake update` moves it on from there.
'''

DRIFT = '''  #
  # The option list you filled this in from was read at one moment and the
  # branch keeps moving, so a setting that exists in nixgen may not exist in
  # what you build. Within a numbered release that is unusual, but it is why
  # naming the commit is the other choice.
'''

UNPINNED = '''  # nixpkgs, following the {channel} branch. A commit was asked for, but nixgen
  # could not find one for this channel, so the first build takes whatever the
  # branch holds at the time and flake.lock records where it landed.
'''

# Following a branch is a mild caveat on a numbered release and a real one on
# unstable, which is a different tree by tomorrow. Said here because this is
# the file someone reads months later, long after the screen that explained it.
UNSTABLE_DRIFT = '''  #
  # nixos-unstable is a different tree by tomorrow. The option list you filled
  # this in from and the tree you build come apart within days, and a setting
  # that exists in nixgen may simply not be there. Naming the commit is what
  # holds the two together; `nix flake update` is what moves you on afterwards.
'''


def _pin(channel, revision, from_index, follow_branch):
    """(comment, ref) for the nixpkgs input.

    Four outcomes, and they are kept apart on purpose: a commit that matches the
    option list, a commit that only makes the build reproducible, a branch the
    user chose, and a branch fallen back to because no commit was available.
    Collapsing the last two would tell someone their choice was honoured when
    it was, or was not, for reasons they cannot see.

    The revision is re-checked here as well as where it was read: it is written
    into a generated file verbatim, and the branch name is a safe thing to fall
    back to when anything looks off.
    """
    drift = UNSTABLE_DRIFT if channel == UNSTABLE else DRIFT
    if follow_branch:
        return BRANCH.format(channel=channel) + drift, channel
    revision = (revision or "").strip()
    if not is_revision(revision):
        return UNPINNED.format(channel=channel) + drift, channel
    body = PINNED_INDEXED if from_index else PINNED_HEAD
    return body.format(channel=channel), revision


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
    state = _safe(kw.get("state_version"),
                  _channel_version(channel, kw.get("release")), _STATE_VERSION)

    carried, carried_paths = _carried(kw.get("carried") or [],
                                      kw.get("imports") or [])
    configuration, defines = _configuration(host, user, system, state, opts,
                                            carried, kw.get("imports") or [])
    # The red "also in configuration.nix" markers read this list, so a carried
    # line has to be on it: adding the same option under Options afterwards
    # would otherwise define it in both files with nothing said.
    defines += carried_paths
    channel = channel or "nixos-26.05"
    pin, ref = _pin(channel, kw.get("revision"),
                    _flag(kw.get("from_index"), False),
                    kw.get("pin", "branch") == "branch")

    return {
        "configuration.nix": configuration,
        "flake.nix": FLAKE.format(host=host, pin=pin, ref=ref, system=system),
        "defines": defines,
        # What the flake ended up naming, so the UI can say which it is. A
        # commit was wanted but not found leaves `revision` empty, which is how
        # the note ends up admitting the branch rather than claiming a pin.
        "channel": channel,
        "revision": ref if ref != channel else None,
    }
